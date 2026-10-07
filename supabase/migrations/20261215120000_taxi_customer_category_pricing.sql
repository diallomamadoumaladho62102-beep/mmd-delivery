-- Customer Taxi categories are standard, comfort, xl, wheelchair_accessible.
-- Pricing rows historically used premium for what the app now calls comfort,
-- and had no wheelchair_accessible row, so quote_taxi_ride returned pricing_not_found.
-- This copies the existing premium schedule onto comfort and the existing XL
-- schedule onto wheelchair_accessible. The quote formula is unchanged.

begin;

do $$
declare
  r record;
begin
  for r in
    select c.conname, rel.relname
    from pg_constraint c
    join pg_class rel on rel.oid = c.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname in ('taxi_pricing', 'taxi_rides')
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%vehicle_class%'
      and pg_get_constraintdef(c.oid) ilike '%premium%'
  loop
    execute format('alter table public.%I drop constraint %I', r.relname, r.conname);
  end loop;
end $$;

alter table public.taxi_pricing
  drop constraint if exists taxi_pricing_vehicle_class_check;
alter table public.taxi_pricing
  add constraint taxi_pricing_vehicle_class_check
  check (vehicle_class in ('standard', 'comfort', 'xl', 'premium', 'wheelchair_accessible'));

alter table public.taxi_rides
  drop constraint if exists taxi_rides_vehicle_class_check;
alter table public.taxi_rides
  add constraint taxi_rides_vehicle_class_check
  check (vehicle_class in ('standard', 'comfort', 'xl', 'premium', 'wheelchair_accessible'));

insert into public.taxi_pricing (
  config_key, vehicle_class, country_code, currency, active,
  base_fare, per_mile, per_minute, min_fare, booking_fee,
  driver_share_pct, platform_share_pct, class_multiplier, max_passengers, notes
)
select
  case
    when src.config_key ~ '_premium$' then regexp_replace(src.config_key, '_premium$', '_comfort')
    else src.config_key || '_comfort'
  end,
  'comfort',
  src.country_code,
  src.currency,
  true,
  src.base_fare,
  src.per_mile,
  src.per_minute,
  src.min_fare,
  src.booking_fee,
  src.driver_share_pct,
  src.platform_share_pct,
  src.class_multiplier,
  src.max_passengers,
  'Comfort schedule copied from the existing premium row. Formula unchanged.'
from (
  select distinct on (country_code) *
  from public.taxi_pricing
  where vehicle_class = 'premium'
    and active = true
  order by country_code, updated_at desc
) src
on conflict (config_key) do update set
  vehicle_class = excluded.vehicle_class,
  country_code = excluded.country_code,
  currency = excluded.currency,
  active = excluded.active,
  base_fare = excluded.base_fare,
  per_mile = excluded.per_mile,
  per_minute = excluded.per_minute,
  min_fare = excluded.min_fare,
  booking_fee = excluded.booking_fee,
  driver_share_pct = excluded.driver_share_pct,
  platform_share_pct = excluded.platform_share_pct,
  class_multiplier = excluded.class_multiplier,
  max_passengers = excluded.max_passengers,
  notes = excluded.notes,
  updated_at = now();

insert into public.taxi_pricing (
  config_key, vehicle_class, country_code, currency, active,
  base_fare, per_mile, per_minute, min_fare, booking_fee,
  driver_share_pct, platform_share_pct, class_multiplier, max_passengers, notes
)
select
  case
    when src.config_key ~ '_xl$' then regexp_replace(src.config_key, '_xl$', '_wheelchair')
    else src.config_key || '_wheelchair'
  end,
  'wheelchair_accessible',
  src.country_code,
  src.currency,
  true,
  src.base_fare,
  src.per_mile,
  src.per_minute,
  src.min_fare,
  src.booking_fee,
  src.driver_share_pct,
  src.platform_share_pct,
  src.class_multiplier,
  src.max_passengers,
  'Wheelchair accessible schedule copied from the existing XL row. Formula unchanged.'
from (
  select distinct on (country_code) *
  from public.taxi_pricing
  where vehicle_class = 'xl'
    and active = true
  order by country_code, updated_at desc
) src
on conflict (config_key) do update set
  vehicle_class = excluded.vehicle_class,
  country_code = excluded.country_code,
  currency = excluded.currency,
  active = excluded.active,
  base_fare = excluded.base_fare,
  per_mile = excluded.per_mile,
  per_minute = excluded.per_minute,
  min_fare = excluded.min_fare,
  booking_fee = excluded.booking_fee,
  driver_share_pct = excluded.driver_share_pct,
  platform_share_pct = excluded.platform_share_pct,
  class_multiplier = excluded.class_multiplier,
  max_passengers = excluded.max_passengers,
  notes = excluded.notes,
  updated_at = now();

commit;
