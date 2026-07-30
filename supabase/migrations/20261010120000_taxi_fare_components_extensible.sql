-- Extensible Taxi fare architecture:
-- 1) fare_components JSONB = canonical named line items for receipts/APIs
-- 2) optional scalar cents columns for known market fees (nullable = unused)
-- 3) taxi_pricing rate-card extensions (surge multiplier, airport/cleaning fees)
-- Legacy rides without fare_components continue to work via reconstruction.

alter table public.taxi_rides
  add column if not exists fare_components jsonb;

comment on column public.taxi_rides.fare_components is
  'Versioned fare line items {version,currency,lines[],rates_snapshot?}. Null = legacy ride; reconstruct at read time.';

alter table public.taxi_rides
  add column if not exists surge_cents integer
    check (surge_cents is null or surge_cents >= 0),
  add column if not exists tolls_cents integer
    check (tolls_cents is null or tolls_cents >= 0),
  add column if not exists parking_cents integer
    check (parking_cents is null or parking_cents >= 0),
  add column if not exists airport_fee_cents integer
    check (airport_fee_cents is null or airport_fee_cents >= 0),
  add column if not exists cleaning_fee_cents integer
    check (cleaning_fee_cents is null or cleaning_fee_cents >= 0),
  add column if not exists regulatory_fee_cents integer
    check (regulatory_fee_cents is null or regulatory_fee_cents >= 0),
  add column if not exists adjustment_cents integer;

comment on column public.taxi_rides.surge_cents is 'Dynamic pricing uplift in cents; null/0 = not applicable.';
comment on column public.taxi_rides.tolls_cents is 'Tolls in cents; null/0 = not applicable.';
comment on column public.taxi_rides.parking_cents is 'Parking in cents; null/0 = not applicable.';
comment on column public.taxi_rides.airport_fee_cents is 'Airport fee in cents; null/0 = not applicable.';
comment on column public.taxi_rides.cleaning_fee_cents is 'Cleaning fee in cents; null/0 = not applicable.';
comment on column public.taxi_rides.regulatory_fee_cents is 'Regulatory fee in cents (distinct from service_fee_cents); null/0 = not applicable.';
comment on column public.taxi_rides.adjustment_cents is 'Manual adjustment in cents (can be negative); null = none.';

alter table public.taxi_pricing
  add column if not exists surge_multiplier numeric(8, 4) not null default 1
    check (surge_multiplier >= 0),
  add column if not exists airport_fee numeric(12, 2) not null default 0
    check (airport_fee >= 0),
  add column if not exists cleaning_fee numeric(12, 2) not null default 0
    check (cleaning_fee >= 0);

comment on column public.taxi_pricing.surge_multiplier is
  'Demand multiplier applied to pre-fee fare (1.0 = no surge).';
comment on column public.taxi_pricing.airport_fee is
  'Default airport fee in major currency units (0 = unused on this market).';
comment on column public.taxi_pricing.cleaning_fee is
  'Default cleaning fee in major currency units (0 = unused).';
