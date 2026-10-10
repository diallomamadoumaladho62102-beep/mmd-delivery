-- XL segment dispatch limits. Do not apply this file with supabase db push.
-- It stays outside supabase/migrations so supabase db push cannot run it.
-- Initial limits are written only while all four columns are still null.
-- An admin edit is kept. The application does not substitute these numbers.
-- max_pickup_meters: 450000, meters. Road distance from the driver to the pickup.
-- The Conakry to Labé corridor is about 410 km, so a driver still upstream can qualify.
-- A longer road distance is rejected.
-- max_detour_meters: 30000, meters beyond the remaining corridor distance.
-- A driver farther off the itinerary than this is rejected.
-- max_pickup_delay_minutes: 180, minutes after the requested pickup.
-- A later road arrival or published schedule is rejected.
-- max_location_age_seconds: 1200, seconds. An older GPS fix is not used.
-- This does not change an existing fare or commission row.

begin;

alter table public.guinea_xl_segment_tariff
  add column if not exists max_pickup_meters integer,
  add column if not exists max_detour_meters integer,
  add column if not exists max_pickup_delay_minutes integer,
  add column if not exists max_location_age_seconds integer;

alter table public.guinea_xl_segment_tariff
  drop constraint if exists guinea_xl_segment_dispatch_limits_check;

alter table public.guinea_xl_segment_tariff
  add constraint guinea_xl_segment_dispatch_limits_check
  check (
    (max_pickup_meters is null or max_pickup_meters >= 0)
    and (max_detour_meters is null or max_detour_meters >= 0)
    and (max_pickup_delay_minutes is null or max_pickup_delay_minutes >= 0)
    and (max_location_age_seconds is null or max_location_age_seconds >= 0)
  );

update public.guinea_xl_segment_tariff
set
  max_pickup_meters = 450000,
  max_detour_meters = 30000,
  max_pickup_delay_minutes = 180,
  max_location_age_seconds = 1200
where id = 'GN'
  and max_pickup_meters is null
  and max_detour_meters is null
  and max_pickup_delay_minutes is null
  and max_location_age_seconds is null;

commit;
