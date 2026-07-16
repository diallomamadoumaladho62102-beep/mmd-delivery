-- Phase 5 taxi production hardening:
-- - country address_config metadata (US vs West Africa)
-- - round-trip columns
-- - immutable pickup/dropoff snapshots after create
-- - GPS-gated arrive / complete RPCs
-- - driver cancel before ride start (no Live Stripe movement)

begin;

-- ---------------------------------------------------------------------------
-- Address config seeds on taxi_countries.metadata
-- ---------------------------------------------------------------------------

update public.taxi_countries
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'address_config', jsonb_build_object(
    'structured_address_mode', true,
    'manual_pin_confirmation_required', false,
    'landmark_prompt_required', false,
    'street_number_required', true,
    'postal_code_required', true,
    'reverse_geocoding_enabled', true,
    'minimum_location_accuracy_meters', 50
  )
)
where upper(country_code) = 'US';

update public.taxi_countries
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'address_config', jsonb_build_object(
    'structured_address_mode', false,
    'manual_pin_confirmation_required', true,
    'landmark_prompt_required', true,
    'street_number_required', false,
    'postal_code_required', false,
    'reverse_geocoding_enabled', true,
    'minimum_location_accuracy_meters', 100
  )
)
where upper(country_code) in ('GN', 'SN', 'CI', 'ML');

-- ---------------------------------------------------------------------------
-- Round-trip columns
-- ---------------------------------------------------------------------------

alter table public.taxi_rides
  add column if not exists trip_mode text not null default 'one_way';

alter table public.taxi_rides
  add column if not exists return_mode text;

alter table public.taxi_rides
  add column if not exists return_wait_minutes integer;

alter table public.taxi_rides
  add column if not exists return_scheduled_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'taxi_rides_trip_mode_check'
  ) then
    alter table public.taxi_rides
      add constraint taxi_rides_trip_mode_check
      check (trip_mode in ('one_way', 'round_trip'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'taxi_rides_return_mode_check'
  ) then
    alter table public.taxi_rides
      add constraint taxi_rides_return_mode_check
      check (
        return_mode is null
        or return_mode in ('immediate', 'wait', 'scheduled')
      );
  end if;
end $$;

comment on column public.taxi_rides.trip_mode is
  'one_way or round_trip. Round-trip pricing includes return to pickup.';
comment on column public.taxi_rides.return_mode is
  'For round_trip: immediate | wait | scheduled.';

-- ---------------------------------------------------------------------------
-- Freeze pickup/dropoff snapshots after insert (non-service-role cannot rewrite)
-- ---------------------------------------------------------------------------

create or replace function public.guard_taxi_ride_location_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and auth.role() <> 'service_role' then
    if new.pickup_lat is distinct from old.pickup_lat
      or new.pickup_lng is distinct from old.pickup_lng
      or new.dropoff_lat is distinct from old.dropoff_lat
      or new.dropoff_lng is distinct from old.dropoff_lng
      or new.pickup_address is distinct from old.pickup_address
      or new.dropoff_address is distinct from old.dropoff_address
    then
      -- Allow unpaid quoted rides to be patched by dedicated service_role APIs only.
      if lower(coalesce(old.payment_status, '')) = 'unpaid'
        and lower(coalesce(old.status, '')) = 'quoted'
        and old.driver_id is null
      then
        null;
      else
        raise exception 'taxi_ride_location_snapshot_immutable';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_taxi_ride_location_snapshot on public.taxi_rides;
create trigger trg_guard_taxi_ride_location_snapshot
  before update on public.taxi_rides
  for each row
  execute function public.guard_taxi_ride_location_snapshot();

-- ---------------------------------------------------------------------------
-- GPS helpers
-- ---------------------------------------------------------------------------

create or replace function public.taxi_haversine_meters(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
returns double precision
language sql
immutable
as $$
  select case
    when p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null then null
    else (
      6371000 * 2 * asin(
        sqrt(
          power(sin(radians(p_lat2 - p_lat1) / 2), 2)
          + cos(radians(p_lat1)) * cos(radians(p_lat2))
            * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
        )
      )
    )
  end;
$$;

-- Replace GPS-free arrive with proximity-gated arrive.
drop function if exists public.driver_arrive_taxi_pickup(uuid);
drop function if exists public.driver_arrive_taxi_pickup(uuid, double precision, double precision);

create or replace function public.driver_arrive_taxi_pickup(
  p_ride_id uuid,
  p_lat double precision,
  p_lng double precision
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_ride public.taxi_rides%rowtype;
  v_old_status text;
  v_distance double precision;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  if p_lat is null or p_lng is null
    or (abs(p_lat) < 0.000001 and abs(p_lng) < 0.000001)
  then
    return jsonb_build_object('ok', false, 'message', 'driver_gps_required');
  end if;

  select *
  into v_ride
  from public.taxi_rides
  where id = p_ride_id
    and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  if not public.is_taxi_driver_eligible(v_driver_id, v_ride.vehicle_class) then
    return jsonb_build_object('ok', false, 'message', 'driver_not_eligible');
  end if;

  if lower(coalesce(v_ride.status, '')) <> 'accepted' then
    return jsonb_build_object('ok', false, 'message', 'invalid_status');
  end if;

  v_distance := public.taxi_haversine_meters(
    p_lat, p_lng, v_ride.pickup_lat, v_ride.pickup_lng
  );

  if v_distance is null then
    return jsonb_build_object('ok', false, 'message', 'pickup_coordinates_missing');
  end if;

  if v_distance > 50 then
    return jsonb_build_object(
      'ok', false,
      'message', case when v_distance <= 150 then 'manual_arrival_required' else 'too_far_from_pickup' end,
      'distance_meters', round(v_distance::numeric, 1)
    );
  end if;

  v_old_status := v_ride.status;

  update public.taxi_rides
  set
    status = 'driver_arrived',
    driver_arrived_at = coalesce(driver_arrived_at, now()),
    updated_at = now()
  where id = p_ride_id
    and driver_id = v_driver_id
    and status = v_ride.status;

  perform public.log_taxi_event(
    p_ride_id,
    'driver_arrived',
    v_old_status,
    'driver_arrived',
    v_driver_id,
    'driver',
    'Driver arrived at pickup (GPS gated)',
    jsonb_build_object('distance_meters', round(v_distance::numeric, 1))
  );

  return jsonb_build_object(
    'ok', true,
    'taxi_ride_id', p_ride_id,
    'status', 'driver_arrived',
    'distance_meters', round(v_distance::numeric, 1)
  );
end;
$$;

-- GPS-gated complete (preserve commissions + loyalty from premium sprint1).
drop function if exists public.driver_complete_taxi_ride(uuid);
drop function if exists public.driver_complete_taxi_ride(uuid, double precision, double precision);

create or replace function public.driver_complete_taxi_ride(
  p_ride_id uuid,
  p_lat double precision,
  p_lng double precision
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_ride public.taxi_rides%rowtype;
  v_old_status text;
  v_refresh jsonb;
  v_loyalty jsonb;
  v_distance double precision;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  if p_lat is null or p_lng is null
    or (abs(p_lat) < 0.000001 and abs(p_lng) < 0.000001)
  then
    return jsonb_build_object('ok', false, 'message', 'driver_gps_required');
  end if;

  select *
  into v_ride
  from public.taxi_rides
  where id = p_ride_id
    and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  if not public.is_taxi_driver_eligible(v_driver_id, v_ride.vehicle_class) then
    return jsonb_build_object('ok', false, 'message', 'driver_not_eligible');
  end if;

  if lower(coalesce(v_ride.status, '')) <> 'in_progress' then
    return jsonb_build_object('ok', false, 'message', 'invalid_status');
  end if;

  v_distance := public.taxi_haversine_meters(
    p_lat, p_lng, v_ride.dropoff_lat, v_ride.dropoff_lng
  );

  if v_distance is null then
    return jsonb_build_object('ok', false, 'message', 'dropoff_coordinates_missing');
  end if;

  if v_distance > 150 then
    return jsonb_build_object(
      'ok', false,
      'message', 'too_far_from_dropoff',
      'distance_meters', round(v_distance::numeric, 1)
    );
  end if;

  v_old_status := v_ride.status;

  update public.taxi_rides
  set
    status = 'completed',
    completed_at = coalesce(completed_at, now()),
    updated_at = now()
  where id = p_ride_id
    and driver_id = v_driver_id
    and status = v_ride.status;

  v_refresh := public.refresh_taxi_commissions(p_ride_id);
  v_loyalty := public.accrue_taxi_loyalty_for_ride(p_ride_id);

  perform public.log_taxi_event(
    p_ride_id,
    'ride_completed',
    v_old_status,
    'completed',
    v_driver_id,
    'driver',
    'Taxi ride completed (GPS gated)',
    jsonb_build_object(
      'commissions', v_refresh,
      'loyalty', v_loyalty,
      'distance_meters', round(v_distance::numeric, 1)
    )
  );

  return jsonb_build_object(
    'ok', true,
    'taxi_ride_id', p_ride_id,
    'status', 'completed',
    'commissions', v_refresh,
    'loyalty', v_loyalty,
    'distance_meters', round(v_distance::numeric, 1)
  );
end;
$$;

-- Driver cancel before start (accepted / driver_arrived). Refund marked required; no Stripe.
create or replace function public.driver_cancel_taxi_ride(
  p_ride_id uuid,
  p_reason text default 'driver_cancelled'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_ride public.taxi_rides%rowtype;
  v_old_status text;
  v_reason text := left(coalesce(nullif(trim(p_reason), ''), 'driver_cancelled'), 120);
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  select *
  into v_ride
  from public.taxi_rides
  where id = p_ride_id
    and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  if lower(coalesce(v_ride.status, '')) not in ('accepted', 'driver_arrived') then
    return jsonb_build_object('ok', false, 'message', 'invalid_status');
  end if;

  v_old_status := v_ride.status;

  update public.taxi_rides
  set
    status = 'canceled',
    cancel_reason = v_reason,
    cancelled_by = 'driver',
    cancelled_at = now(),
    refund_status = case
      when lower(coalesce(payment_status, '')) = 'paid' then 'full_refund_required'
      else coalesce(refund_status, 'none')
    end,
    updated_at = now()
  where id = p_ride_id
    and driver_id = v_driver_id
    and status = v_ride.status;

  perform public.log_taxi_event(
    p_ride_id,
    'driver_cancel',
    v_old_status,
    'canceled',
    v_driver_id,
    'driver',
    'Driver cancelled taxi ride before start',
    jsonb_build_object(
      'reason', v_reason,
      'stripe_refund_deferred', true,
      'refund', case
        when lower(coalesce(v_ride.payment_status, '')) = 'paid' then 'REQUIRED'
        else 'NONE'
      end
    )
  );

  return jsonb_build_object(
    'ok', true,
    'taxi_ride_id', p_ride_id,
    'status', 'canceled',
    'refund', case
      when lower(coalesce(v_ride.payment_status, '')) = 'paid' then 'REQUIRED'
      else 'NONE'
    end
  );
end;
$$;

revoke all on function public.driver_arrive_taxi_pickup(uuid, double precision, double precision) from public;
revoke all on function public.driver_complete_taxi_ride(uuid, double precision, double precision) from public;
revoke all on function public.driver_cancel_taxi_ride(uuid, text) from public;

grant execute on function public.driver_arrive_taxi_pickup(uuid, double precision, double precision) to authenticated;
grant execute on function public.driver_complete_taxi_ride(uuid, double precision, double precision) to authenticated;
grant execute on function public.driver_cancel_taxi_ride(uuid, text) to authenticated;

commit;
