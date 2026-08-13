-- =============================================================================
-- CUSTOMER APP — optional DEMO catalog seed (clearly labeled, non-transactional)
-- =============================================================================
-- Purpose: populate marketing advertisements when the catalog is empty so Home
-- promo chrome can render real rows from public.advertisements (not UI mocks).
--
-- Safe to re-run: inserts only when placement 'client_home' has zero active ads.
-- Does NOT create fake users, payments, orders, or taxi rides.
--
-- Apply manually when needed:
--   supabase db execute -f supabase/seed/customer_app_demo_catalog.sql
-- or run via SQL editor against a non-production / staging project first.
-- =============================================================================

begin;

insert into public.advertisements (
  title,
  subtitle,
  image_url,
  button_text,
  button_action,
  placement,
  category,
  priority,
  display_order,
  is_active
)
select
  v.title,
  v.subtitle,
  v.image_url,
  v.button_text,
  v.button_action,
  'client_home',
  'Campagnes MMD',
  v.priority,
  v.display_order,
  true
from (
  values
    (
      '[DEMO] MMD Promo',
      'Free delivery this weekend',
      'https://placehold.co/752x312/001F66/FFFFFF/png?text=MMD+Promo',
      'Learn more',
      'food',
      10,
      1
    ),
    (
      '[DEMO] Ride with MMD',
      'Safe taxi across your city',
      'https://placehold.co/752x312/003399/FFD700/png?text=MMD+Taxi',
      'Book taxi',
      'taxi',
      5,
      2
    )
) as v(title, subtitle, image_url, button_text, button_action, priority, display_order)
where not exists (
  select 1
  from public.advertisements a
  where a.placement = 'client_home'
    and coalesce(a.is_active, true) = true
  limit 1
);

commit;
