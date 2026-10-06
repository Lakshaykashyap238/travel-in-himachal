-- Customer reviews shown on the website. The owner copies real reviews
-- (from Google, WhatsApp, etc.) into /admin; nothing is seeded here.
create table public.reviews (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 60),        -- reviewer's name
  place       text check (char_length(place) <= 60),                           -- where they are from, optional
  trip        text check (char_length(trip) <= 80),                            -- e.g. "Spiti tour, May 2026"
  rating      smallint not null default 5 check (rating between 1 and 5),
  body        text not null check (char_length(body) between 10 and 700),
  source      text not null default 'Google' check (source in ('Google', 'WhatsApp', 'Instagram', 'Facebook', 'In person', 'Other')),
  image_path  text,                                                            -- reserved (reviewer photo); unused for now
  is_active   boolean not null default true,
  sort_order  integer not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger reviews_updated_at before update on public.reviews
  for each row execute function public.set_updated_at();
create trigger reviews_changed after insert or update or delete on public.reviews
  for each statement execute function public.mark_content_changed();

alter table public.reviews enable row level security;
grant select on public.reviews to anon, authenticated;
grant insert, update, delete on public.reviews to authenticated;
create policy "reviews readable" on public.reviews for select
  to anon, authenticated using (is_active or (select public.is_staff()));
create policy "owner manages reviews" on public.reviews for all
  to authenticated using ((select public.is_owner())) with check ((select public.is_owner()));
