-- Phase 1 (ADR-001): configuration store for business defaults.
-- Seeds mirror apps/web/src/lib/pricingEngine/config/businessDefaults.ts exactly.
-- Runtime continues to use in-code parity defaults unless explicitly switched later.
-- No pricing formula changes.

begin;

create table if not exists public.pricing_business_defaults (
  key text primary key,
  value_numeric numeric not null,
  description text,
  category text not null default 'general',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

comment on table public.pricing_business_defaults is
  'ADR-001 Phase 1: externalized business tariff defaults (parity with legacy hardcodes).';

alter table public.pricing_business_defaults enable row level security;

drop policy if exists pricing_business_defaults_admin_all on public.pricing_business_defaults;
create policy pricing_business_defaults_admin_all
  on public.pricing_business_defaults
  for all
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.role = 'admin'
          or coalesce(p.is_founder, false) = true
          or public.is_founder_user(auth.uid())
        )
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and (
          p.role = 'admin'
          or coalesce(p.is_founder, false) = true
          or public.is_founder_user(auth.uid())
        )
    )
  );

drop policy if exists pricing_business_defaults_service_read on public.pricing_business_defaults;
-- service_role bypasses RLS; authenticated non-admin: no direct read (server uses service role / in-code defaults)

insert into public.pricing_business_defaults (key, value_numeric, description, category)
values
  ('delivery_base_fare', 2.5, 'Delivery V1 base fare (USD)', 'delivery_v1'),
  ('delivery_per_mile', 0.9, 'Delivery V1 per mile', 'delivery_v1'),
  ('delivery_per_minute', 0.15, 'Delivery V1 per minute', 'delivery_v1'),
  ('delivery_min_fare', 3.49, 'Delivery V1 minimum fare', 'delivery_v1'),
  ('delivery_driver_share_pct', 80, 'Delivery driver share %', 'delivery_v1'),
  ('delivery_platform_share_pct', 20, 'Delivery platform share %', 'delivery_v1'),
  ('delivery_fee_abnormal_multiplier', 8, 'Abnormal fee multiplier guard', 'delivery_v1'),
  ('delivery_fee_abnormal_absolute_usd', 40, 'Abnormal fee absolute USD guard', 'delivery_v1'),

  ('delivery_v2_base_fee', 2.5, 'V2 shadow customer base fee', 'delivery_v2'),
  ('delivery_v2_per_mile', 0.9, 'V2 shadow customer per mile', 'delivery_v2'),
  ('delivery_v2_per_minute', 0.15, 'V2 shadow customer per minute', 'delivery_v2'),
  ('delivery_v2_service_fee', 0.99, 'V2 shadow customer service fee', 'delivery_v2'),
  ('delivery_v2_surge_multiplier', 1, 'V2 shadow surge multiplier', 'delivery_v2'),
  ('delivery_v2_min_total', 3.49, 'V2 shadow min total', 'delivery_v2'),
  ('delivery_v2_driver_per_mile', 0.72, 'V2 shadow driver per mile', 'delivery_v2'),
  ('delivery_v2_driver_per_minute', 0.12, 'V2 shadow driver per minute', 'delivery_v2'),
  ('delivery_v2_pickup_per_mile', 0.05, 'V2 shadow pickup adj per mile', 'delivery_v2'),
  ('delivery_v2_pickup_cap', 0.75, 'V2 shadow pickup adj cap', 'delivery_v2'),

  ('marketplace_delivery_fee_floor_cents', 299, 'Marketplace delivery fee floor (cents)', 'marketplace'),
  ('marketplace_delivery_fee_pct', 0.08, 'Marketplace delivery fee percent of subtotal', 'marketplace'),

  ('food_legacy_tax_rate', 0.0888, 'US food tax fallback when catalog empty', 'tax'),

  ('taxi_shared_ride_discount_percent', 15, 'Shared ride discount %', 'taxi'),
  ('taxi_shared_ride_match_window_minutes', 15, 'Shared ride match window minutes', 'taxi'),
  ('taxi_quote_drift_tolerance_cents', 50, 'Quote drift absolute cents', 'taxi'),
  ('taxi_quote_drift_tolerance_ratio', 0.02, 'Quote drift ratio', 'taxi'),
  ('taxi_no_show_compensation_pct', 0.05, 'No-show compensation fraction of ride', 'taxi'),
  ('taxi_tip_min_cents', 50, 'Minimum taxi tip cents', 'taxi'),

  ('wait_timer_free_minutes', 5, 'Free wait minutes', 'wait'),
  ('wait_fee_tier1_rate_cents', 25, 'Wait tier1 cents/min', 'wait'),
  ('wait_fee_tier1_minutes', 3, 'Wait tier1 duration minutes', 'wait'),
  ('wait_fee_tier2_rate_cents', 30, 'Wait tier2 cents/min', 'wait'),
  ('wait_fee_tier2_minutes', 5, 'Wait tier2 duration minutes', 'wait'),
  ('wait_fee_max_cents', 225, 'Wait fee cap cents', 'wait'),
  ('driver_arrival_max_meters', 50, 'GPS arrival max meters', 'wait'),
  ('driver_arrival_manual_review_meters', 150, 'Manual arrival review meters', 'wait'),

  ('mmd_credit_min_residual_cents', 50, 'Min residual Stripe charge with credit', 'thresholds'),
  ('driver_cashout_minimum_cents', 2000, 'Driver cashout minimum cents', 'thresholds'),
  ('driver_cashout_cooldown_ms', 86400000, 'Driver cashout cooldown ms (24h)', 'thresholds')
on conflict (key) do update
set
  value_numeric = excluded.value_numeric,
  description = excluded.description,
  category = excluded.category,
  updated_at = now();

commit;
