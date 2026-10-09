-- Guinea Standard motorcycle is a vehicle class on the existing taxi_rides table.
-- This does not change fares, shares, USA classes, or existing rows.
-- Do not apply until explicitly authorized.

alter table public.taxi_rides
  drop constraint if exists taxi_rides_vehicle_class_check;

alter table public.taxi_rides
  add constraint taxi_rides_vehicle_class_check
  check (
    vehicle_class in (
      'standard',
      'comfort',
      'xl',
      'premium',
      'wheelchair_accessible',
      'motorcycle'
    )
  );
