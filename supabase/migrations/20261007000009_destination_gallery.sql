-- Extra photos for the slideshow at the top of each destination page.
-- The destination's main photo is always the first slide; tours to the
-- destination add theirs automatically, and these add more (up to 8).
alter table public.destinations
  add column gallery text[] not null default '{}'
    check (cardinality(gallery) <= 8);

-- Start the slideshows with photos from the original website that show the
-- same area (only where the destination has no slideshow photos yet).
update public.destinations d set gallery = g.photos
  from (values
    ('manali',      array['/images/tours/manali-2.jpg']),
    ('kasol',       array['/images/tours/manikaran.jpg']),
    ('dharamshala', array['/images/tours/mcleodganj.jpg']),
    ('mcleodganj',  array['/images/tours/dharamshala.jpg']),
    ('kangra',      array['/images/tours/dharamshala.jpg', '/images/tours/mcleodganj.jpg']),
    ('dalhousie',   array['/images/tours/chamba.jpg']),
    ('chamba',      array['/images/tours/dalhousie.jpg'])
  ) as g(slug, photos)
 where d.slug = g.slug and d.gallery = '{}';
