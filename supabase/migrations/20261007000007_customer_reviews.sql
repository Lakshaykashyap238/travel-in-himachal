-- Customers can write a review on the website. To keep reviews genuine,
-- they must give a booking reference and the phone number used for that
-- booking, and the booking must have been confirmed. Reviews arrive hidden
-- and appear only after the owner approves them in /admin.

alter table public.reviews
  add column booking_id    uuid unique references public.bookings (id) on delete set null,
  add column from_customer boolean not null default false;

alter table public.reviews drop constraint reviews_source_check;
alter table public.reviews add constraint reviews_source_check
  check (source in ('Website', 'Google', 'WhatsApp', 'Instagram', 'Facebook', 'In person', 'Other'));

create index reviews_pending_idx on public.reviews (created_at) where from_customer and not is_active;

create or replace function public.submit_review(
  p_reference text,
  p_phone     text,
  p_name      text,
  p_place     text,
  p_rating    integer,
  p_body      text
)
returns text   -- 'ok' | 'invalid' | 'not_found' | 'not_eligible' | 'already_reviewed' | 'busy'
language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.bookings%rowtype;
  v_digits  text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_trip    text;
begin
  if p_reference is null or p_reference !~* '^TIH-\d{1,9}$'
     or char_length(v_digits) < 10
     or char_length(btrim(coalesce(p_name, ''))) not between 2 and 60
     or char_length(btrim(coalesce(p_place, ''))) > 60
     or p_rating is null or p_rating not between 1 and 5
     or char_length(btrim(coalesce(p_body, ''))) not between 10 and 700 then
    return 'invalid';
  end if;

  -- Flood guard: at most 30 reviews waiting for approval from the last hour.
  if (select count(*) from public.reviews r
      where r.from_customer and not r.is_active and r.created_at > now() - interval '1 hour') >= 30 then
    return 'busy';
  end if;

  -- Match the booking by reference and the last 10 digits of its phone number.
  select * into v_booking from public.bookings b
  where b.reference = upper(btrim(p_reference))
    and right(regexp_replace(b.phone, '\D', '', 'g'), 10) = right(v_digits, 10);
  if not found then
    return 'not_found';
  end if;

  if v_booking.status not in ('accepted', 'completed') then
    return 'not_eligible';
  end if;

  if exists (select 1 from public.reviews r where r.booking_id = v_booking.id) then
    return 'already_reviewed';
  end if;

  select coalesce(pk.name, 'Cab trip') || ', ' || to_char(v_booking.travel_date, 'Mon YYYY')
    into v_trip
  from public.bookings b left join public.packages pk on pk.id = b.package_id
  where b.id = v_booking.id;

  insert into public.reviews (name, place, trip, rating, body, source, is_active, from_customer, booking_id, sort_order)
  values (btrim(p_name), nullif(btrim(coalesce(p_place, '')), ''), v_trip, p_rating, btrim(p_body),
          'Website', false, true, v_booking.id, 100);
  return 'ok';
end $$;

revoke all on function public.submit_review(text, text, text, text, integer, text) from public;
grant execute on function public.submit_review(text, text, text, text, integer, text) to anon, authenticated;
