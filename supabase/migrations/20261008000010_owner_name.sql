-- The business owner is Hitesh Thakur. His name is shown on the website
-- (About page, Contact page and footer). Owners can change it later in
-- admin → Business details → "Owner name".
update public.site_settings
   set founder_name = 'Hitesh Thakur'
 where founder_name is null or btrim(founder_name) in ('', 'Lakshay Kashyap');
