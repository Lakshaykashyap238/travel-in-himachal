-- ════════════════════════════════════════════════════════════════════
-- Admin dashboard support
--   1. Two-factor login (MFA) is REQUIRED for every staff/owner action.
--      A password alone (session level aal1) grants nothing.
--   2. Booking history and staff names for the dashboard.
--   3. Notification queue: new-booking alerts to staff (phone push +
--      email), decision emails to customers, reminders for bookings left
--      pending. Delivered by the `notify` Edge Function.
-- ════════════════════════════════════════════════════════════════════

-- ── 1. MFA-gated staff checks ───────────────────────────────────────
create or replace function public.has_mfa()
returns boolean language sql stable set search_path = '' as $$
  select coalesce((select auth.jwt()) ->> 'aal', '') = 'aal2'
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_mfa() and exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid()) and s.is_active
  )
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_mfa() and exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid()) and s.is_active and s.role = 'owner'
  )
$$;

grant execute on function public.has_mfa() to anon, authenticated;

-- ── 2. Dashboard helpers ────────────────────────────────────────────
-- Names of staff, for "handled by" and history. Staff only.
create or replace function public.staff_directory()
returns table (user_id uuid, full_name text, role public.staff_role, is_active boolean)
language sql stable security definer set search_path = '' as $$
  select s.user_id, s.full_name, s.role, s.is_active
  from public.staff s
  where public.is_staff()
  order by s.full_name
$$;

-- A booking's full history with who did what. Staff only.
create or replace function public.booking_history(p_booking_id uuid)
returns table (id bigint, kind text, from_status public.booking_status, to_status public.booking_status,
               note text, actor_name text, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select e.id, e.kind, e.from_status, e.to_status, e.note,
         coalesce(s.full_name, case when e.actor_id is null then 'Customer' else 'Former staff' end),
         e.created_at
  from public.booking_events e
  left join public.staff s on s.user_id = e.actor_id
  where public.is_staff() and e.booking_id = p_booking_id
  order by e.created_at, e.id
$$;

revoke all on function public.staff_directory(), public.booking_history(uuid) from public, anon;
grant execute on function public.staff_directory(), public.booking_history(uuid) to authenticated;

-- ── 3. Notification queue ───────────────────────────────────────────
create table public.notification_outbox (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('booking_created', 'booking_decided', 'pending_reminder')),
  booking_id  uuid not null references public.bookings (id) on delete cascade,
  created_at  timestamptz not null default now(),
  attempts    integer not null default 0,
  sent_at     timestamptz,
  last_error  text
);
create index notification_outbox_unsent_idx on public.notification_outbox (created_at) where sent_at is null;
create unique index notification_outbox_one_reminder on public.notification_outbox (booking_id) where kind = 'pending_reminder';

alter table public.notification_outbox enable row level security;   -- no policies: service role only

-- Ask the notify Edge Function to deliver one queued item. Uses pg_net and
-- two Vault secrets (notify_url, notify_secret). If either is missing, the
-- item simply waits for the next sweep — nothing is lost.
create or replace function public.dispatch_notification(p_outbox_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_url    text;
  v_secret text;
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return;
  end if;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'notify_url'$q$ into v_url;
  execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'notify_secret'$q$ into v_secret;
  if v_url is null or v_secret is null then
    return;
  end if;
  execute $q$select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)$q$
    using v_url,
          jsonb_build_object('outbox_id', p_outbox_id),
          jsonb_build_object('Content-Type', 'application/json', 'x-notify-secret', v_secret);
end $$;

create or replace function public.outbox_dispatch_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.dispatch_notification(new.id);
  return null;
end $$;

create trigger notification_outbox_dispatch
  after insert on public.notification_outbox
  for each row execute function public.outbox_dispatch_trigger();

-- Queue alerts from booking events.
create or replace function public.queue_booking_notifications()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.notification_outbox (kind, booking_id) values ('booking_created', new.id);
  elsif new.status is distinct from old.status
        and old.status = 'pending'
        and new.status in ('accepted', 'rejected')
        and new.email is not null then
    insert into public.notification_outbox (kind, booking_id) values ('booking_decided', new.id);
  end if;
  return null;
end $$;

create trigger bookings_queue_notifications
  after insert or update of status on public.bookings
  for each row execute function public.queue_booking_notifications();

-- Periodic job (every 5 minutes via pg_cron):
--   • remind staff about bookings still pending after 30 minutes (once each)
--   • retry notifications that haven't been delivered (up to 5 attempts)
create or replace function public.run_notification_jobs()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer := 0;
  r record;
begin
  insert into public.notification_outbox (kind, booking_id)
  select 'pending_reminder', b.id
  from public.bookings b
  where b.status = 'pending'
    and b.created_at < now() - interval '30 minutes'
    and b.created_at > now() - interval '2 days'
  on conflict do nothing;

  for r in
    select o.id from public.notification_outbox o
    where o.sent_at is null and o.attempts < 5
      and o.created_at < now() - interval '2 minutes'
    order by o.id limit 50
  loop
    perform public.dispatch_notification(r.id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Recipients for staff alerts (the notify function uses the service role).
create or replace function public.staff_alert_recipients()
returns table (user_id uuid, full_name text, role public.staff_role, email text)
language sql stable security definer set search_path = '' as $$
  select s.user_id, s.full_name, s.role, u.email::text
  from public.staff s join auth.users u on u.id = s.user_id
  where s.is_active
$$;

revoke all on function public.dispatch_notification(bigint), public.outbox_dispatch_trigger(),
  public.queue_booking_notifications(), public.run_notification_jobs(), public.staff_alert_recipients()
  from public, anon, authenticated;
grant execute on function public.run_notification_jobs(), public.staff_alert_recipients() to service_role;

-- Schedule the job where pg_cron is available (it is on Supabase).
do $cron$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    execute $q$select cron.schedule('tih-notification-jobs', '*/5 * * * *', 'select public.run_notification_jobs()')$q$;
  end if;
end
$cron$;

-- ── 4. Never lock the business out ─────────────────────────────────
-- There must always be at least one active owner.
create or replace function public.keep_an_owner()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.staff where role = 'owner' and is_active) then
    raise exception 'last_owner: at least one active owner is required' using errcode = 'P0001';
  end if;
  return null;
end $$;

create constraint trigger staff_keep_an_owner
  after update or delete on public.staff
  deferrable initially immediate
  for each row execute function public.keep_an_owner();

revoke all on function public.keep_an_owner() from public, anon, authenticated;

-- Push devices belong to staff members (lets the notify function send only to
-- active staff, and removes devices automatically when a staff row is deleted).
alter table public.push_subscriptions
  add constraint push_subscriptions_staff_fk
  foreign key (user_id) references public.staff (user_id) on delete cascade;
