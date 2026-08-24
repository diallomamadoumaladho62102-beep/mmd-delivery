-- Route distance policy limits (ADR-001 pricing_business_defaults).
-- Seeds mirror apps/web/src/lib/pricingEngine/config/businessDefaults.ts.

begin;

insert into public.pricing_business_defaults (key, value_numeric, description, category)
values
  (
    'taxi_max_distance_miles',
    300,
    'Maximum allowed taxi ride distance (miles)',
    'taxi'
  ),
  (
    'delivery_max_distance_miles',
    60,
    'Maximum allowed delivery distance (miles)',
    'delivery_v1'
  )
on conflict (key) do update
set
  value_numeric = excluded.value_numeric,
  description = excluded.description,
  category = excluded.category,
  updated_at = now();

commit;
