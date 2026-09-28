-- ════════════════════════════════════════════════════════════════════
-- Travel In Himachal — initial schema
-- Bookings inbox with an admin workflow (accept / reject / complete).
--
-- Security model
--   • The public (anon) can read active packages & vehicles, and can look
--     up ONE booking by its secret tracking token. Nothing else.
--   • New bookings are created only by the create-booking Edge Function
--     (service_role) via create_booking(), after bot + rate-limit checks.
--   • Staff read bookings through RLS and change them only through
--     set_booking_status() / add_booking_note(), which enforce the
--     allowed status transitions and write an append-only audit trail.
--   • Only the owner can edit packages, vehicles and staff.
-- ════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

-- ── Types ────────────────────────────────────────────────────────────
create type public.booking_type   as enum ('tour', 'cab');
create type public.booking_status as enum ('pending', 'accepted', 'rejected', 'completed', 'cancelled');
create type public.staff_role     as enum ('owner', 'staff');

-- ── Helpers ──────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Today's date in India, regardless of the server's time zone.
create or replace function public.today_ist()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Kolkata')::date
$$;

-- ── Catalogue ────────────────────────────────────────────────────────
create table public.packages (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name            text not null check (char_length(name) between 2 and 120),
  duration_days   smallint not null check (duration_days between 1 and 30),
  duration_nights smallint not null check (duration_nights between 0 and 30),
  starting_price  integer check (starting_price >= 0),          -- ₹ per traveller; null = price on request
  best_time       text,
  group_size      text,
  summary         text check (char_length(summary) <= 300),
  description     text check (char_length(description) <= 10000),
  image_path      text,
  is_active       boolean not null default true,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table public.vehicles (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name           text not null check (char_length(name) between 2 and 80),
  seats          smallint not null check (seats between 1 and 60),
  luggage        smallint not null default 0 check (luggage between 0 and 60),
  price_per_day  integer check (price_per_day >= 0),            -- ₹; null = price on request
  features       text[] not null default '{}',
  description    text check (char_length(description) <= 2000),
  image_path     text,
  is_active      boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger packages_updated_at before update on public.packages
  for each row execute function public.set_updated_at();
create trigger vehicles_updated_at before update on public.vehicles
  for each row execute function public.set_updated_at();

-- ── Staff ────────────────────────────────────────────────────────────
create table public.staff (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null check (char_length(full_name) between 2 and 80),
  role       public.staff_role not null default 'staff',
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid()) and s.is_active
  )
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff s
    where s.user_id = (select auth.uid()) and s.is_active and s.role = 'owner'
  )
$$;

-- ── Bookings ─────────────────────────────────────────────────────────
create sequence public.booking_reference_seq start 10001;

create table public.bookings (
  id                uuid primary key default gen_random_uuid(),
  reference         text not null unique
                      default 'TIH-' || nextval('public.booking_reference_seq')::text,
  tracking_token    text not null unique
                      default encode(extensions.gen_random_bytes(24), 'hex'),
  type              public.booking_type not null,
  package_id        uuid references public.packages (id) on delete restrict,
  vehicle_id        uuid not null references public.vehicles (id) on delete restrict,
  customer_name     text not null check (char_length(customer_name) between 2 and 80),
  phone             text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  email             text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  travel_date       date not null,
  travellers        smallint not null check (travellers between 1 and 20),
  pickup            text not null check (char_length(pickup) between 2 and 200),
  dropoff           text check (char_length(dropoff) <= 200),
  notes             text check (char_length(notes) <= 1000),
  status            public.booking_status not null default 'pending',
  agreed_fare       integer check (agreed_fare >= 0),            -- ₹, set when accepting
  rejection_reason  text check (char_length(rejection_reason) <= 500),
  handled_by        uuid references auth.users (id) on delete set null,
  handled_at        timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint tour_needs_package  check (type <> 'tour' or package_id is not null),
  constraint cab_needs_dropoff   check (type <> 'cab'  or dropoff is not null),
  constraint rejected_has_reason check (status <> 'rejected' or rejection_reason is not null)
);

create index bookings_status_created_idx on public.bookings (status, created_at desc);
create index bookings_travel_date_idx    on public.bookings (travel_date);
create index bookings_phone_idx          on public.bookings (phone);

create trigger bookings_updated_at before update on public.bookings
  for each row execute function public.set_updated_at();

-- Append-only audit trail of everything that happens to a booking.
create table public.booking_events (
  id          bigint generated always as identity primary key,
  booking_id  uuid not null references public.bookings (id) on delete cascade,
  actor_id    uuid references auth.users (id) on delete set null,  -- null = customer / system
  kind        text not null check (kind in ('created', 'status_changed', 'note')),
  from_status public.booking_status,
  to_status   public.booking_status,
  note        text check (char_length(note) <= 1000),
  created_at  timestamptz not null default now()
);
create index booking_events_booking_idx on public.booking_events (booking_id, created_at);

create or replace function public.forbid_event_changes()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'booking_events is append-only';
end $$;

create trigger booking_events_immutable
  before update or delete on public.booking_events
  for each row when (pg_trigger_depth() = 0)
  execute function public.forbid_event_changes();

-- Rate-limit ledger for the public booking form (no personal data beyond
-- the phone number already in the booking and a salted IP hash).
create table public.booking_attempts (
  id         bigint generated always as identity primary key,
  phone      text not null,
  ip_hash    text not null,
  created_at timestamptz not null default now()
);
create index booking_attempts_phone_idx on public.booking_attempts (phone, created_at desc);
create index booking_attempts_ip_idx    on public.booking_attempts (ip_hash, created_at desc);

-- Web Push subscriptions for staff alert devices.
create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

-- ════════════════════════════════════════════════════════════════════
-- Business functions
-- ════════════════════════════════════════════════════════════════════

-- Create a booking. Called ONLY by the create-booking Edge Function with
-- the service role, after it has verified the bot check. Re-validates
-- everything and enforces rate limits.
create or replace function public.create_booking(p jsonb, p_ip_hash text)
returns table (reference text, tracking_token text)
language plpgsql security definer set search_path = '' as $$
declare
  v_type       public.booking_type;
  v_package_id uuid;
  v_vehicle_id uuid;
  v_date       date;
  v_phone      text := trim(p ->> 'phone');
  v_booking    public.bookings;
begin
  if p_ip_hash is null or char_length(p_ip_hash) < 16 then
    raise exception 'invalid_input: ip hash' using errcode = '22023';
  end if;

  begin
    v_type := (p ->> 'type')::public.booking_type;
    v_date := (p ->> 'travelDate')::date;
  exception when others then
    raise exception 'invalid_input: type or date' using errcode = '22023';
  end;

  if v_date < public.today_ist() or v_date > public.today_ist() + 180 then
    raise exception 'invalid_date' using errcode = '22023';
  end if;

  -- Rate limits: 3 per phone per 24h, 10 per IP per hour.
  if (select count(*) from public.booking_attempts a
        where a.phone = v_phone and a.created_at > now() - interval '24 hours') >= 3
     or (select count(*) from public.booking_attempts a
        where a.ip_hash = p_ip_hash and a.created_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  insert into public.booking_attempts (phone, ip_hash) values (v_phone, p_ip_hash);

  select v.id into v_vehicle_id from public.vehicles v
   where v.slug = p ->> 'vehicleSlug' and v.is_active;
  if v_vehicle_id is null then
    raise exception 'unavailable_item: vehicle' using errcode = 'P0001';
  end if;

  if v_type = 'tour' then
    select pk.id into v_package_id from public.packages pk
     where pk.slug = p ->> 'packageSlug' and pk.is_active;
    if v_package_id is null then
      raise exception 'unavailable_item: package' using errcode = 'P0001';
    end if;
  end if;

  insert into public.bookings (
    type, package_id, vehicle_id, customer_name, phone, email,
    travel_date, travellers, pickup, dropoff, notes
  ) values (
    v_type, v_package_id, v_vehicle_id,
    trim(p ->> 'customerName'), v_phone, nullif(lower(trim(p ->> 'email')), ''),
    v_date, (p ->> 'travellers')::smallint, trim(p ->> 'pickup'),
    nullif(trim(p ->> 'dropoff'), ''), nullif(trim(p ->> 'notes'), '')
  )
  returning * into v_booking;

  insert into public.booking_events (booking_id, kind, to_status)
  values (v_booking.id, 'created', 'pending');

  return query select v_booking.reference, v_booking.tracking_token;
end $$;

-- Change a booking's status. Staff only; enforces allowed transitions.
--   pending  → accepted | rejected
--   accepted → completed | cancelled
create or replace function public.set_booking_status(
  p_booking_id  uuid,
  p_status      public.booking_status,
  p_agreed_fare integer default null,
  p_reason      text default null,
  p_note        text default null
)
returns public.bookings
language plpgsql security definer set search_path = '' as $$
declare
  v_old public.bookings;
  v_new public.bookings;
begin
  if not public.is_staff() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into v_old from public.bookings where id = p_booking_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if not (
       (v_old.status = 'pending'  and p_status in ('accepted', 'rejected'))
    or (v_old.status = 'accepted' and p_status in ('completed', 'cancelled'))
  ) then
    raise exception 'invalid_transition: % -> %', v_old.status, p_status using errcode = 'P0001';
  end if;

  if p_status = 'rejected' and coalesce(trim(p_reason), '') = '' then
    raise exception 'reason_required' using errcode = '22023';
  end if;
  if p_agreed_fare is not null and p_agreed_fare < 0 then
    raise exception 'invalid_fare' using errcode = '22023';
  end if;

  update public.bookings b set
    status           = p_status,
    agreed_fare      = case when p_status = 'accepted' then p_agreed_fare else b.agreed_fare end,
    rejection_reason = case when p_status = 'rejected' then trim(p_reason) else b.rejection_reason end,
    handled_by       = (select auth.uid()),
    handled_at       = now()
  where b.id = p_booking_id
  returning * into v_new;

  insert into public.booking_events (booking_id, actor_id, kind, from_status, to_status, note)
  values (p_booking_id, (select auth.uid()), 'status_changed', v_old.status, p_status,
          nullif(trim(coalesce(p_note, p_reason)), ''));

  return v_new;
end $$;

-- Add an internal note to a booking. Staff only.
create or replace function public.add_booking_note(p_booking_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'note_required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.bookings where id = p_booking_id) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.booking_events (booking_id, actor_id, kind, note)
  values (p_booking_id, (select auth.uid()), 'note', trim(p_note));
end $$;

-- Customer-facing lookup by secret token. Returns only what the customer
-- needs to see — no internal notes, no staff identities.
create or replace function public.get_booking_by_token(p_token text)
returns table (
  reference        text,
  type             public.booking_type,
  package_name     text,
  vehicle_name     text,
  travel_date      date,
  travellers       smallint,
  pickup           text,
  dropoff          text,
  status           public.booking_status,
  agreed_fare      integer,
  rejection_reason text,
  created_at       timestamptz,
  updated_at       timestamptz
)
language sql stable security definer set search_path = '' as $$
  select b.reference, b.type, pk.name, v.name, b.travel_date, b.travellers,
         b.pickup, b.dropoff, b.status, b.agreed_fare, b.rejection_reason,
         b.created_at, b.updated_at
  from public.bookings b
  join public.vehicles v on v.id = b.vehicle_id
  left join public.packages pk on pk.id = b.package_id
  where p_token ~ '^[0-9a-f]{48}$' and b.tracking_token = p_token
$$;

-- ════════════════════════════════════════════════════════════════════
-- Privileges & row-level security
-- Supabase grants broad table privileges to anon/authenticated by
-- default; revoke them and grant back only what each role needs.
-- ════════════════════════════════════════════════════════════════════
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

alter table public.packages           enable row level security;
alter table public.vehicles           enable row level security;
alter table public.staff              enable row level security;
alter table public.bookings           enable row level security;
alter table public.booking_events     enable row level security;
alter table public.booking_attempts   enable row level security;
alter table public.push_subscriptions enable row level security;

-- Catalogue: everyone reads active items; staff also see hidden ones; owner edits.
grant select on public.packages, public.vehicles to anon, authenticated;
grant insert, update, delete on public.packages, public.vehicles to authenticated;

create policy "catalogue readable" on public.packages for select
  to anon, authenticated using (is_active or (select public.is_staff()));
create policy "owner manages packages" on public.packages for all
  to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

create policy "catalogue readable" on public.vehicles for select
  to anon, authenticated using (is_active or (select public.is_staff()));
create policy "owner manages vehicles" on public.vehicles for all
  to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

-- Staff table: each staff member sees themselves; the owner sees and manages all.
grant select, insert, update, delete on public.staff to authenticated;
create policy "staff see self, owner sees all" on public.staff for select
  to authenticated using (user_id = (select auth.uid()) or (select public.is_owner()));
create policy "owner manages staff" on public.staff for all
  to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

-- Bookings & events: staff can read; all changes go through the functions above.
grant select on public.bookings, public.booking_events to authenticated;
create policy "staff read bookings" on public.bookings for select
  to authenticated using ((select public.is_staff()));
create policy "staff read events" on public.booking_events for select
  to authenticated using ((select public.is_staff()));

-- booking_attempts: no policies → no access for anon/authenticated.

-- Push subscriptions: staff manage their own devices.
grant select, insert, delete on public.push_subscriptions to authenticated;
create policy "own push subscriptions" on public.push_subscriptions for all
  to authenticated
  using (user_id = (select auth.uid()) and (select public.is_staff()))
  with check (user_id = (select auth.uid()) and (select public.is_staff()));

-- Function access.
grant execute on function public.get_booking_by_token(text) to anon, authenticated;
grant execute on function public.set_booking_status(uuid, public.booking_status, integer, text, text) to authenticated;
grant execute on function public.add_booking_note(uuid, text) to authenticated;
-- is_staff()/is_owner() are used inside RLS policies that anon also hits
-- (they simply return false for visitors).
grant execute on function public.is_staff(), public.is_owner() to anon, authenticated;
grant execute on function public.today_ist() to anon, authenticated;
grant execute on function public.create_booking(jsonb, text) to service_role;

-- New objects must not become public by accident.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

-- ── Real-time ────────────────────────────────────────────────────────
-- Admin dashboards subscribe to booking inserts/updates. Realtime applies
-- the RLS policies above, so only staff receive them.
alter publication supabase_realtime add table public.bookings;
