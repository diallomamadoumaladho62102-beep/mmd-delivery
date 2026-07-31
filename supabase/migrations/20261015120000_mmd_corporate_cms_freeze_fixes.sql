-- Corporate CMS freeze fixes: marketing menu portals + optimized hero asset paths.
-- Idempotent.

update public.site_menu_items
set href = '/p/restaurants'
where href = '/restaurants'
  and menu_id in (
    select id from public.site_menus where key = 'header' and locale = 'en'
  );

update public.site_menu_items
set href = '/p/business'
where href = '/business'
  and menu_id in (
    select id from public.site_menus where key = 'header' and locale = 'en'
  );

update public.site_settings
set payload = jsonb_set(
  coalesce(payload, '{}'::jsonb),
  '{hero_image_url}',
  to_jsonb('/brand/hero/hero-rider.webp'::text),
  true
),
updated_at = now()
where locale = 'en'
  and coalesce(payload->>'hero_image_url', '') in (
    '',
    '/brand/hero/hero-rider.png'
  );

update public.site_page_blocks b
set payload = jsonb_set(
  coalesce(b.payload, '{}'::jsonb),
  '{image_url}',
  to_jsonb('/brand/hero/hero-rider.webp'::text),
  true
),
updated_at = now()
from public.site_pages p
where b.page_id = p.id
  and p.slug = 'home'
  and p.locale = 'en'
  and b.block_type = 'hero'
  and coalesce(b.payload->>'image_url', '') in (
    '',
    '/brand/hero/hero-rider.png'
  );
