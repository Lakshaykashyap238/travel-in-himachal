-- Anyone can write a review on the website, whether they booked online, by
-- phone or in person. No booking reference is needed. Reviews still arrive
-- hidden and appear only after the owner approves them in /admin, which is
-- what keeps fake or rude reviews off the site.
--
-- The older submit_review (reference + phone check) is kept so pages that
-- are still cached in a visitor's browser keep working; the website no
-- longer uses it.

create or replace function public.submit_open_review(
  p_name   text,
  p_place  text,
  p_rating integer,
  p_body   text
)
returns text   -- 'ok' | 'invalid' | 'busy'
language plpgsql security definer set search_path = '' as $$
begin
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 60
     or char_length(btrim(coalesce(p_place, ''))) > 60
     or p_rating is null or p_rating not between 1 and 5
     or char_length(btrim(coalesce(p_body, ''))) not between 10 and 700 then
    return 'invalid';
  end if;

  -- Flood guard: at most 30 reviews waiting for approval from the last hour,
  -- and at most 200 waiting in total, so spam can't bury real reviews.
  if (select count(*) from public.reviews r
      where r.from_customer and not r.is_active and r.created_at > now() - interval '1 hour') >= 30
     or (select count(*) from public.reviews r where r.from_customer and not r.is_active) >= 200 then
    return 'busy';
  end if;

  -- Same review sent twice (double tap / resend): accept quietly, store once.
  if exists (select 1 from public.reviews r
             where r.from_customer and not r.is_active
               and r.name = btrim(p_name) and r.body = btrim(p_body)) then
    return 'ok';
  end if;

  insert into public.reviews (name, place, rating, body, source, is_active, from_customer, sort_order)
  values (btrim(p_name), nullif(btrim(coalesce(p_place, '')), ''), p_rating, btrim(p_body),
          'Website', false, true, 100);
  return 'ok';
end $$;

revoke all on function public.submit_open_review(text, text, integer, text) from public;
grant execute on function public.submit_open_review(text, text, integer, text) to anon, authenticated;
