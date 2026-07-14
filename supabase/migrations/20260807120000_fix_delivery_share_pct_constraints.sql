-- Fix invalid delivery fee share percentages on pricing_config and enforce
-- server-side invariants so Admin/runtime can never persist driver+platform > 100.
--
-- Root cause context:
-- food/errand loaders historically passed only delivery_platform_pct into
-- computeDeliveryPricing while driverSharePct defaulted to 80. Any Admin
-- config with delivery_platform_pct > 20 then failed at checkout with
-- "driverSharePct + platformSharePct must be <= 100" even when
-- delivery_driver_pct + delivery_platform_pct was a valid 70/30.

begin;

-- ---------------------------------------------------------------------------
-- 1) Normalize accidental 0–1 fraction values to 0–100 scale
-- ---------------------------------------------------------------------------

update public.pricing_config
set
  delivery_driver_pct = round(delivery_driver_pct * 100, 2),
  updated_at = now()
where delivery_driver_pct > 0
  and delivery_driver_pct <= 1;

update public.pricing_config
set
  delivery_platform_pct = round(delivery_platform_pct * 100, 2),
  updated_at = now()
where delivery_platform_pct > 0
  and delivery_platform_pct <= 1;

-- ---------------------------------------------------------------------------
-- 2) Repair invalid food/errand delivery splits (sum > 100 or not exactly 100)
--    Safe default: 80% driver / 20% platform on the delivery fee only.
--    Does NOT touch restaurant_pct / platform_pct (vendor commission base).
-- ---------------------------------------------------------------------------

update public.pricing_config
set
  delivery_driver_pct = 80,
  delivery_platform_pct = 20,
  updated_at = now()
where coalesce(order_type, '') in ('food', 'errand')
  and (
    delivery_driver_pct + delivery_platform_pct > 100
    or (
      delivery_driver_pct + delivery_platform_pct > 0
      and abs((delivery_driver_pct + delivery_platform_pct) - 100) > 0.009
    )
    or delivery_driver_pct < 0
    or delivery_platform_pct < 0
    or delivery_driver_pct > 100
    or delivery_platform_pct > 100
  );

-- Marketplace (and any future non-delivery rows) that only accidentally
-- exceed 100 are clamped to 0/0 so checkout paths that ignore delivery
-- shares stay clean.
update public.pricing_config
set
  delivery_driver_pct = 0,
  delivery_platform_pct = 0,
  updated_at = now()
where coalesce(order_type, '') not in ('food', 'errand')
  and (
    delivery_driver_pct + delivery_platform_pct > 100
    or delivery_driver_pct < 0
    or delivery_platform_pct < 0
    or delivery_driver_pct > 100
    or delivery_platform_pct > 100
  );

-- ---------------------------------------------------------------------------
-- 3) Enforce bounds + sum <= 100 at the database layer
-- ---------------------------------------------------------------------------

alter table public.pricing_config
  drop constraint if exists pricing_config_delivery_share_pct_bounds_check;

alter table public.pricing_config
  add constraint pricing_config_delivery_share_pct_bounds_check
  check (
    delivery_driver_pct >= 0
    and delivery_driver_pct <= 100
    and delivery_platform_pct >= 0
    and delivery_platform_pct <= 100
    and delivery_driver_pct + delivery_platform_pct <= 100
  );

comment on constraint pricing_config_delivery_share_pct_bounds_check on public.pricing_config is
  'Delivery fee split only (driver + platform). Independent from restaurant_pct + platform_pct.';

commit;
