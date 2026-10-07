-- Start the taxi wait timer in the same server transaction as GPS pickup arrival.
-- Does not change wait rates. Duplicate arrival cannot move the original timestamp.

begin;

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
    wait_timer_started_at = coalesce(wait_timer_started_at, driver_arrived_at, now()),
    driver_distance_to_target_meters = coalesce(driver_distance_to_target_meters, round(v_distance::numeric, 2)),
    manual_arrival_required = false,
    wait_fee_status = case
      when wait_fee_status in ('charged', 'waived', 'capped', 'accruing') then wait_fee_status
      else 'free'
    end,
    wait_arrival_lat = coalesce(wait_arrival_lat, p_lat),
    wait_arrival_lng = coalesce(wait_arrival_lng, p_lng),
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

revoke all on function public.driver_arrive_taxi_pickup(uuid, double precision, double precision) from public;
grant execute on function public.driver_arrive_taxi_pickup(uuid, double precision, double precision) to authenticated;

commit;
