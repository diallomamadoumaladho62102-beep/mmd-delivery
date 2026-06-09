-- Taxi Globalization Sprint 2: country pricing data (INSERT-only expansion).
-- US pricing already seeded in 20260609120000_taxi_sprint1_infrastructure.sql.
-- Adds 10 countries × 3 vehicle classes = 30 rows (33 total with existing US).

begin;

insert into public.taxi_pricing (
  config_key,
  vehicle_class,
  country_code,
  currency,
  active,
  base_fare,
  per_mile,
  per_minute,
  min_fare,
  booking_fee,
  driver_share_pct,
  platform_share_pct,
  class_multiplier,
  max_passengers,
  notes
)
values
  -- Canada (CAD)
  ('taxi_ca_standard', 'standard', 'CA', 'CAD', true, 3.00, 1.35, 0.25, 6.00, 1.25, 75, 25, 1.0, 4, 'Taxi CA Standard MVP'),
  ('taxi_ca_xl', 'xl', 'CA', 'CAD', true, 4.00, 1.65, 0.32, 8.50, 1.75, 75, 25, 1.35, 6, 'Taxi CA XL MVP'),
  ('taxi_ca_premium', 'premium', 'CA', 'CAD', true, 5.50, 2.10, 0.40, 12.00, 2.25, 72, 28, 1.75, 4, 'Taxi CA Premium MVP'),

  -- United Kingdom (GBP)
  ('taxi_gb_standard', 'standard', 'GB', 'GBP', true, 2.50, 1.75, 0.28, 5.50, 1.00, 75, 25, 1.0, 4, 'Taxi GB Standard MVP'),
  ('taxi_gb_xl', 'xl', 'GB', 'GBP', true, 3.25, 2.15, 0.35, 7.50, 1.50, 75, 25, 1.35, 6, 'Taxi GB XL MVP'),
  ('taxi_gb_premium', 'premium', 'GB', 'GBP', true, 4.75, 2.65, 0.42, 11.00, 2.00, 72, 28, 1.75, 4, 'Taxi GB Premium MVP'),

  -- France (EUR)
  ('taxi_fr_standard', 'standard', 'FR', 'EUR', true, 2.80, 1.50, 0.32, 6.00, 1.00, 75, 25, 1.0, 4, 'Taxi FR Standard MVP'),
  ('taxi_fr_xl', 'xl', 'FR', 'EUR', true, 3.60, 1.85, 0.38, 8.00, 1.50, 75, 25, 1.35, 6, 'Taxi FR XL MVP'),
  ('taxi_fr_premium', 'premium', 'FR', 'EUR', true, 5.20, 2.30, 0.45, 12.00, 2.00, 72, 28, 1.75, 4, 'Taxi FR Premium MVP'),

  -- Belgium (EUR)
  ('taxi_be_standard', 'standard', 'BE', 'EUR', true, 2.80, 1.50, 0.32, 6.00, 1.00, 75, 25, 1.0, 4, 'Taxi BE Standard MVP'),
  ('taxi_be_xl', 'xl', 'BE', 'EUR', true, 3.60, 1.85, 0.38, 8.00, 1.50, 75, 25, 1.35, 6, 'Taxi BE XL MVP'),
  ('taxi_be_premium', 'premium', 'BE', 'EUR', true, 5.20, 2.30, 0.45, 12.00, 2.00, 72, 28, 1.75, 4, 'Taxi BE Premium MVP'),

  -- Guinea (GNF — whole units, stored as main currency amounts)
  ('taxi_gn_standard', 'standard', 'GN', 'GNF', true, 15000, 8000, 1500, 30000, 5000, 75, 25, 1.0, 4, 'Taxi GN Standard MVP'),
  ('taxi_gn_xl', 'xl', 'GN', 'GNF', true, 20000, 10000, 2000, 45000, 7000, 75, 25, 1.35, 6, 'Taxi GN XL MVP'),
  ('taxi_gn_premium', 'premium', 'GN', 'GNF', true, 28000, 13000, 2500, 65000, 10000, 72, 28, 1.75, 4, 'Taxi GN Premium MVP'),

  -- Senegal (XOF — whole units)
  ('taxi_sn_standard', 'standard', 'SN', 'XOF', true, 1000, 600, 150, 2000, 300, 75, 25, 1.0, 4, 'Taxi SN Standard MVP'),
  ('taxi_sn_xl', 'xl', 'SN', 'XOF', true, 1400, 750, 180, 2800, 450, 75, 25, 1.35, 6, 'Taxi SN XL MVP'),
  ('taxi_sn_premium', 'premium', 'SN', 'XOF', true, 2000, 950, 220, 4000, 600, 72, 28, 1.75, 4, 'Taxi SN Premium MVP'),

  -- Côte d'Ivoire (XOF)
  ('taxi_ci_standard', 'standard', 'CI', 'XOF', true, 1000, 600, 150, 2000, 300, 75, 25, 1.0, 4, 'Taxi CI Standard MVP'),
  ('taxi_ci_xl', 'xl', 'CI', 'XOF', true, 1400, 750, 180, 2800, 450, 75, 25, 1.35, 6, 'Taxi CI XL MVP'),
  ('taxi_ci_premium', 'premium', 'CI', 'XOF', true, 2000, 950, 220, 4000, 600, 72, 28, 1.75, 4, 'Taxi CI Premium MVP'),

  -- Mali (XOF)
  ('taxi_ml_standard', 'standard', 'ML', 'XOF', true, 1000, 600, 150, 2000, 300, 75, 25, 1.0, 4, 'Taxi ML Standard MVP'),
  ('taxi_ml_xl', 'xl', 'ML', 'XOF', true, 1400, 750, 180, 2800, 450, 75, 25, 1.35, 6, 'Taxi ML XL MVP'),
  ('taxi_ml_premium', 'premium', 'ML', 'XOF', true, 2000, 950, 220, 4000, 600, 72, 28, 1.75, 4, 'Taxi ML Premium MVP'),

  -- Sierra Leone (SLE)
  ('taxi_sl_standard', 'standard', 'SL', 'SLE', true, 25.00, 12.00, 2.50, 50.00, 5.00, 75, 25, 1.0, 4, 'Taxi SL Standard MVP'),
  ('taxi_sl_xl', 'xl', 'SL', 'SLE', true, 35.00, 15.00, 3.20, 70.00, 8.00, 75, 25, 1.35, 6, 'Taxi SL XL MVP'),
  ('taxi_sl_premium', 'premium', 'SL', 'SLE', true, 50.00, 18.00, 4.00, 100.00, 12.00, 72, 28, 1.75, 4, 'Taxi SL Premium MVP'),

  -- Mauritania (MRU)
  ('taxi_mr_standard', 'standard', 'MR', 'MRU', true, 40.00, 25.00, 4.00, 80.00, 10.00, 75, 25, 1.0, 4, 'Taxi MR Standard MVP'),
  ('taxi_mr_xl', 'xl', 'MR', 'MRU', true, 55.00, 32.00, 5.00, 110.00, 15.00, 75, 25, 1.35, 6, 'Taxi MR XL MVP'),
  ('taxi_mr_premium', 'premium', 'MR', 'MRU', true, 75.00, 40.00, 6.00, 150.00, 20.00, 72, 28, 1.75, 4, 'Taxi MR Premium MVP')
on conflict (config_key) do update
set
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
