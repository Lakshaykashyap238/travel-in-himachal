-- ════════════════════════════════════════════════════════════════════
-- Everything on the public website is editable by the owner in /admin:
-- business details, tours (prices, photos, places, itinerary), cars,
-- destinations. The website is static, so edits go live when the owner
-- presses "Publish changes" (see the publish-site Edge Function).
-- ════════════════════════════════════════════════════════════════════

-- ── Business details (a single row) ─────────────────────────────────
create table public.site_settings (
  id                boolean primary key default true check (id),
  business_name     text not null default 'Travel In Himachal' check (char_length(business_name) between 2 and 80),
  tagline           text check (char_length(tagline) <= 160),
  phone             text check (phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
  whatsapp          text check (whatsapp is null or whatsapp ~ '^\+[1-9][0-9]{7,14}$'),
  email             text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  address           text check (char_length(address) <= 300),
  hours             text check (char_length(hours) <= 120),
  about             text check (char_length(about) <= 5000),
  founder_name      text check (char_length(founder_name) <= 80),
  instagram_url     text check (instagram_url is null or instagram_url ~ '^https://'),
  facebook_url      text check (facebook_url  is null or facebook_url  ~ '^https://'),
  google_review_url text check (google_review_url is null or google_review_url ~ '^https://'),
  -- Headline numbers ("500+ happy travellers"). Hidden on the site unless set:
  -- only publish figures the business can stand behind.
  stat_travellers   integer check (stat_travellers >= 0),
  stat_years        integer check (stat_years >= 0),
  cancellation_policy text check (char_length(cancellation_policy) <= 5000),
  updated_at        timestamptz not null default now()
);

insert into public.site_settings (business_name, tagline, phone, email, address, founder_name, about)
values (
  'Travel In Himachal',
  'Tours and cabs across Himachal Pradesh',
  '+917876846613',
  'support@travelinhimachal.co.in',
  'Himachal Pradesh, India',
  'Lakshay Kashyap',
  'Travelling is not just about reaching a destination, but about everything that happens along the way — winding mountain roads, peaceful valleys, snow-covered peaks and the warmth of local people. We plan tours and rides that are comfortable and dependable, so you spend less time worrying about the journey and more time enjoying the mountains.'
);

create trigger site_settings_updated_at before update on public.site_settings
  for each row execute function public.set_updated_at();

-- ── Destinations (one public page each) ──────────────────────────────
create table public.destinations (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name        text not null check (char_length(name) between 2 and 80),
  summary     text check (char_length(summary) <= 300),
  description text check (char_length(description) <= 10000),
  places      text[] not null default '{}',
  image_path  text,
  is_active   boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger destinations_updated_at before update on public.destinations
  for each row execute function public.set_updated_at();

-- ── Richer tour details ──────────────────────────────────────────────
alter table public.packages
  add column places     text[] not null default '{}',
  -- [{ "day": 1, "title": "Arrive in Shimla", "details": "…" }, …]
  add column itinerary  jsonb  not null default '[]'::jsonb check (jsonb_typeof(itinerary) = 'array'),
  add column inclusions text[] not null default '{}',
  add column exclusions text[] not null default '{}',
  add column destination_id uuid references public.destinations (id) on delete set null;

-- ── Publish tracking ────────────────────────────────────────────────
-- Any catalogue edit marks the site as having unpublished changes.
create table public.publish_state (
  id                     boolean primary key default true check (id),
  content_changed_at     timestamptz,
  last_publish_at        timestamptz,
  last_publish_by        uuid references auth.users (id) on delete set null
);
insert into public.publish_state (id) values (true);

create or replace function public.mark_content_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.publish_state set content_changed_at = now() where id;
  return null;
end $$;

create trigger packages_changed     after insert or update or delete on public.packages
  for each statement execute function public.mark_content_changed();
create trigger vehicles_changed     after insert or update or delete on public.vehicles
  for each statement execute function public.mark_content_changed();
create trigger destinations_changed after insert or update or delete on public.destinations
  for each statement execute function public.mark_content_changed();
create trigger settings_changed     after insert or update or delete on public.site_settings
  for each statement execute function public.mark_content_changed();

-- Owner asks to publish. Throttled to once per 2 minutes so a double
-- click can't queue several builds. The publish-site Edge Function calls
-- this with the owner's own login, then triggers the build.
create or replace function public.request_publish()
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare v_last timestamptz;
begin
  if not public.is_owner() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select last_publish_at into v_last from public.publish_state where id for update;
  if v_last is not null and v_last > now() - interval '2 minutes' then
    raise exception 'too_soon' using errcode = 'P0001';
  end if;
  update public.publish_state
     set last_publish_at = now(), last_publish_by = (select auth.uid())
   where id;
  return now();
end $$;

-- ── Privileges & RLS ─────────────────────────────────────────────────
alter table public.site_settings  enable row level security;
alter table public.destinations   enable row level security;
alter table public.publish_state  enable row level security;

grant select on public.site_settings, public.destinations to anon, authenticated;
grant update on public.site_settings to authenticated;
grant insert, update, delete on public.destinations to authenticated;
grant select on public.publish_state to authenticated;

create policy "settings readable" on public.site_settings for select to anon, authenticated using (true);
create policy "owner edits settings" on public.site_settings for update to authenticated
  using ((select public.is_owner())) with check ((select public.is_owner()));

create policy "destinations readable" on public.destinations for select
  to anon, authenticated using (is_active or (select public.is_staff()));
create policy "owner manages destinations" on public.destinations for all
  to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));

create policy "staff see publish state" on public.publish_state for select
  to authenticated using ((select public.is_staff()));

revoke all on function public.mark_content_changed() from public, anon, authenticated;
revoke all on function public.request_publish() from public, anon;
grant execute on function public.request_publish() to authenticated;

-- ── Photo storage (Supabase Storage) ─────────────────────────────────
-- Public-read bucket for tour/car/destination photos; only the owner
-- uploads. Skipped automatically where Supabase Storage isn't present
-- (e.g. the plain-Postgres test database).
do $storage$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('catalogue', 'catalogue', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
    on conflict (id) do nothing;

    execute $p$create policy "owner uploads catalogue photos" on storage.objects for insert
      to authenticated with check (bucket_id = 'catalogue' and (select public.is_owner()))$p$;
    execute $p$create policy "owner updates catalogue photos" on storage.objects for update
      to authenticated using (bucket_id = 'catalogue' and (select public.is_owner()))$p$;
    execute $p$create policy "owner deletes catalogue photos" on storage.objects for delete
      to authenticated using (bucket_id = 'catalogue' and (select public.is_owner()))$p$;
  end if;
end
$storage$;

-- ── Seed: destinations and places (from the original site) ──────────
insert into public.destinations (slug, name, places, image_path, sort_order) values
  ('shimla',      'Shimla',       array['Jakhoo Temple','The Ridge','Mall Road','Christ Church','Kufri','Green Valley','Mashobra','Naldehra','Chail','Rohru'], '/images/tours/shimla.jpg', 10),
  ('manali',      'Manali',       array['Hadimba Temple','Solang Valley','Rohtang Pass','Atal Tunnel','Jogini Waterfall','Vashisht Temple','Old Manali','Manu Temple'], '/images/tours/manali.jpg', 20),
  ('dharamshala', 'Dharamshala',  array['McLeodganj','Bhagsu Waterfall','Triund','Dal Lake','Namgyal Monastery','St. John Church'], '/images/tours/dharamshala.jpg', 30),
  ('spiti-valley','Spiti Valley', array['Key Monastery','Chandratal Lake','Kaza','Hikkim','Langza','Komic'], '/images/tours/spiti.jpg', 40),
  ('kasol',       'Kasol',        array['Manikaran Sahib','Tosh','Kheerganga','Chalal','Pulga','Malana'], '/images/tours/kasol.jpg', 50),
  ('kangra',      'Kangra',       array['Kangra Fort','Masroor Temple','Kareri Lake','Bir Billing','Baijnath Temple'], '/images/tours/kangra.jpg', 60),
  ('dalhousie',   'Dalhousie',    array['Khajjiar','Panchpula','Dainkund Peak','Satdhara Falls','St. John''s Church'], '/images/tours/dalhousie.jpg', 70),
  ('mandi',       'Mandi',        array['Prashar Lake','Rewalsar Lake','Bhutnath Temple','Barot Valley'], '/images/tours/prashar-lake.jpg', 80),
  ('mcleodganj',  'McLeodganj',   array['Bhagsu Falls','Triund','Dal Lake','Namgyal Monastery'], '/images/tours/mcleodganj.jpg', 90),
  ('kinnaur',     'Kinnaur',      array['Kalpa','Sangla Valley','Chitkul','Reckong Peo'], '/images/tours/kinnaur.jpg', 100),
  ('chamba',      'Chamba',       array['Khajjiar','Chamunda Temple','Bhuri Singh Museum','Chamera Lake'], '/images/tours/chamba.jpg', 110),
  ('kasauli',     'Kasauli',      array['Monkey Point','Gilbert Trail','Sunset Point','Christ Church','Mall Road'], '/images/tours/kasauli.jpg', 120);

-- Link each tour to its destination and copy the places it covers.
update public.packages p
   set destination_id = d.id, places = d.places
  from public.destinations d
 where (p.slug, d.slug) in (
   ('shimla-kufri-3-days', 'shimla'),
   ('kangra-bir-billing-3-days', 'kangra'),
   ('dharamshala-3-days', 'dharamshala'),
   ('spiti-kaza-7-days', 'spiti-valley'),
   ('mcleodganj-3-days', 'mcleodganj'),
   ('kasauli-2-days', 'kasauli'),
   ('kullu-kasol-manikaran-4-days', 'kasol'),
   ('dalhousie-khajjiar-3-days', 'dalhousie'),
   ('kinnaur-sangla-6-days', 'kinnaur'),
   ('chamba-bharmour-4-days', 'chamba')
 );

-- Standard inclusions from the old cards ("Cab included", "Safe driving").
update public.packages set inclusions = array['Private cab with experienced driver', 'Pickup and drop'];

-- Seeding counts as the first publish, not an unpublished change.
update public.publish_state set content_changed_at = null where id;
