-- Initial catalogue, taken from the original himachaltourism.html.
-- Fixes carried over from the audit of the old site:
--   • "Kangra and Bir Billing Tour" appeared twice → kept once.
--   • Kinnaur, Chamba and Tirthan reused the Dalhousie photo → correct photos.
--   • Every tour showed the placeholder price ₹8,999 → starting_price is left
--     NULL ("price on request") until the owner confirms real prices in /admin.
-- Best time / group size are copied as-is and should be reviewed by the owner.

insert into public.packages
  (slug, name, duration_days, duration_nights, best_time, group_size, image_path, sort_order)
values
  ('shimla-kufri-3-days',               'Shimla & Kufri Tour',                 3, 2, 'Mar – Jun', '2 – 6 people', '/images/tours/shimla.jpg',       10),
  ('kangra-bir-billing-3-days',         'Kangra & Bir Billing Tour',           3, 2, 'Mar – Jun', '2 – 6 people', '/images/tours/kangra.jpg',       20),
  ('dharamshala-3-days',                'Dharamshala Tour',                    3, 2, 'Mar – Jun', '2 – 6 people', '/images/tours/dharamshala.jpg',  30),
  ('spiti-kaza-7-days',                 'Spiti & Kaza Tour',                   7, 6, 'Mar – Jun', '2 – 6 people', '/images/tours/spiti.jpg',        40),
  ('mcleodganj-3-days',                 'McLeodganj Tour',                     3, 2, 'Mar – Jun', '2 – 6 people', '/images/tours/mcleodganj.jpg',   50),
  ('kasauli-2-days',                    'Kasauli Tour',                        2, 1, 'Mar – Jun', '2 – 6 people', '/images/tours/kasauli.jpg',      60),
  ('kullu-kasol-manikaran-4-days',      'Kullu, Kasol & Manikaran Sahib Tour', 4, 3, 'Mar – Jun', '2 – 6 people', '/images/tours/manikaran.jpg',    70),
  ('dalhousie-khajjiar-3-days',         'Dalhousie & Khajjiar Tour',           3, 2, 'Mar – Jun', '2 – 6 people', '/images/tours/dalhousie.jpg',    80),
  ('kinnaur-sangla-6-days',             'Kinnaur & Sangla Valley Tour',        6, 5, 'Mar – Jun', '2 – 6 people', '/images/tours/kinnaur.jpg',      90),
  ('chamba-bharmour-4-days',            'Chamba & Bharmour Tour',              4, 3, 'Mar – Jun', '2 – 6 people', '/images/tours/chamba.jpg',      100),
  ('tirthan-jibhi-3-days',              'Tirthan Valley & Jibhi Tour',         3, 2, 'Mar – Jun', '2 – 6 people', '/images/tours/manali.jpg',      110);

insert into public.vehicles
  (slug, name, seats, luggage, price_per_day, features, description, image_path, sort_order)
values
  ('suzuki-dzire',  'Suzuki Dzire',  4, 3, 2500,
   array['Air conditioning','Music system','Power windows','Comfortable seats','Boot space','First aid kit'],
   'Comfortable sedan for couples and small families.', '/images/fleet/dzire.png', 10),
  ('maruti-ertiga', 'Maruti Ertiga', 5, 4, 3500,   -- old site said 5 seats; owner to confirm
   array['Air conditioning','Music system','Power windows','Comfortable seats','Boot space','First aid kit'],
   'Spacious MPV for families and groups.', '/images/fleet/ertiga.png', 20);
