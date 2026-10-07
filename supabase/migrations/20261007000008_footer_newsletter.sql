-- Footer from the original site: X and YouTube links, and a real
-- "Get Travel Updates" newsletter sign-up (the original button saved nothing).

alter table public.site_settings
  add column x_url       text check (x_url       is null or x_url       ~ '^https://'),
  add column youtube_url text check (youtube_url is null or youtube_url ~ '^https://');

create table public.newsletter_subscribers (
  id         bigint generated always as identity primary key,
  email      text not null unique check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 160),
  created_at timestamptz not null default now()
);
create index newsletter_subscribers_created_idx on public.newsletter_subscribers (created_at);

alter table public.newsletter_subscribers enable row level security;
grant select, delete on public.newsletter_subscribers to authenticated;
create policy "owner reads subscribers" on public.newsletter_subscribers for select
  to authenticated using ((select public.is_owner()));
create policy "owner removes subscribers" on public.newsletter_subscribers for delete
  to authenticated using ((select public.is_owner()));

-- Visitors subscribe only through this function (no direct table access).
create or replace function public.subscribe_newsletter(p_email text)
returns text   -- 'ok' | 'invalid' | 'busy'
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if char_length(v_email) > 160 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return 'invalid';
  end if;
  -- Flood guard: at most 100 new sign-ups per hour.
  if (select count(*) from public.newsletter_subscribers s where s.created_at > now() - interval '1 hour') >= 100 then
    return 'busy';
  end if;
  insert into public.newsletter_subscribers (email) values (v_email) on conflict (email) do nothing;
  return 'ok';   -- same answer for new and existing emails, so the list can't be probed
end $$;

revoke all on function public.subscribe_newsletter(text) from public;
grant execute on function public.subscribe_newsletter(text) to anon, authenticated;
