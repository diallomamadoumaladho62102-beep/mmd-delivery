-- Taxi client identification: snapshot driver + vehicle display fields on accept.
-- Freezes history if the driver later changes profile/vehicle.

begin;

alter table public.taxi_rides
  add column if not exists driver_display_name text,
  add column if not exists driver_photo_url text,
  add column if not exists driver_rating_snapshot numeric(4, 2),
  add column if not exists driver_trips_count_snapshot integer,
  add column if not exists vehicle_make_snapshot text,
  add column if not exists vehicle_model_snapshot text,
  add column if not exists vehicle_year_snapshot integer,
  add column if not exists vehicle_color_snapshot text,
  add column if not exists vehicle_plate_snapshot text,
  add column if not exists vehicle_photo_url_snapshot text;

comment on column public.taxi_rides.driver_display_name is
  'Client-facing driver name frozen at accept';
comment on column public.taxi_rides.vehicle_plate_snapshot is
  'Client-facing license plate frozen at accept';

create or replace function public.driver_accept_taxi_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_offer public.taxi_offers%rowtype;
  v_ride public.taxi_rides%rowtype;
  v_validation jsonb;
  v_vehicle_id uuid;
  v_fuel text;
  v_is_green boolean;
  v_old_status text;
  v_sync jsonb;
  v_vehicle public.driver_vehicles%rowtype;
  v_driver_name text;
  v_driver_photo text;
  v_driver_rating numeric(4, 2);
  v_driver_trips integer;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  select * into v_offer
  from public.taxi_offers
  where id = p_offer_id and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'offer_not_found');
  end if;

  v_validation := public.validate_taxi_offer_acceptance(p_offer_id);

  if coalesce((v_validation->>'ok')::boolean, false) is not true then
    update public.taxi_offers
    set
      status = 'rejected',
      reject_reason_code = v_validation->>'reason_code',
      reject_reason_message = v_validation->>'reason_message',
      updated_at = now()
    where id = p_offer_id;

    insert into public.taxi_accept_audit_events (
      taxi_ride_id, taxi_offer_id, driver_user_id, vehicle_id,
      reason_code, reason_message, metadata
    ) values (
      v_offer.taxi_ride_id,
      p_offer_id,
      v_driver_id,
      nullif(v_validation->>'vehicle_id', '')::uuid,
      coalesce(v_validation->>'reason_code', 'validation_failed'),
      v_validation->>'reason_message',
      v_validation
    );

    return jsonb_build_object(
      'ok', false,
      'message', coalesce(v_validation->>'reason_code', 'validation_failed'),
      'reason_message', v_validation->>'reason_message',
      'should_redispatch', true,
      'taxi_ride_id', v_offer.taxi_ride_id
    );
  end if;

  v_vehicle_id := (v_validation->>'vehicle_id')::uuid;
  v_fuel := v_validation->>'fuel_type';
  v_is_green := coalesce((v_validation->>'is_green_vehicle')::boolean, false);

  select * into v_vehicle
  from public.driver_vehicles
  where id = v_vehicle_id
    and driver_user_id = v_driver_id
    and deleted_at is null;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'message', 'vehicle_not_found',
      'should_redispatch', true,
      'taxi_ride_id', v_offer.taxi_ride_id
    );
  end if;

  select
    coalesce(
      nullif(trim(p.full_name), ''),
      nullif(trim(dp.full_name), ''),
      'Chauffeur'
    ),
    coalesce(nullif(trim(dp.photo_url), ''), nullif(trim(p.avatar_url), '')),
    coalesce(dp.rating, tdf.rating_taxi),
    coalesce(dp.total_deliveries, dp.rating_count, 0)
  into v_driver_name, v_driver_photo, v_driver_rating, v_driver_trips
  from public.driver_profiles dp
  left join public.profiles p on p.id = dp.user_id
  left join public.taxi_driver_features tdf on tdf.user_id = dp.user_id
  where dp.user_id = v_driver_id;

  select * into v_ride from public.taxi_rides where id = v_offer.taxi_ride_id for update;

  update public.taxi_rides
  set
    driver_id = v_driver_id,
    status = 'accepted',
    accepted_at = now(),
    assigned_vehicle_id = v_vehicle_id,
    assigned_fuel_type = v_fuel,
    is_green_vehicle = v_is_green,
    driver_display_name = v_driver_name,
    driver_photo_url = v_driver_photo,
    driver_rating_snapshot = v_driver_rating,
    driver_trips_count_snapshot = v_driver_trips,
    vehicle_make_snapshot = v_vehicle.vehicle_make,
    vehicle_model_snapshot = v_vehicle.vehicle_model,
    vehicle_year_snapshot = v_vehicle.vehicle_year,
    vehicle_color_snapshot = v_vehicle.vehicle_color,
    vehicle_plate_snapshot = v_vehicle.license_plate,
    vehicle_photo_url_snapshot = null,
    updated_at = now()
  where id = v_ride.id
    and driver_id is null
    and lower(coalesce(payment_status, '')) = 'paid'
    and lower(coalesce(status, '')) in ('paid', 'dispatching');

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_no_longer_available', 'should_redispatch', true);
  end if;

  update public.taxi_offers
  set status = 'accepted', vehicle_id = v_vehicle_id, fuel_type = v_fuel, updated_at = now()
  where id = p_offer_id;

  update public.taxi_offers
  set status = 'superseded', updated_at = now()
  where taxi_ride_id = v_offer.taxi_ride_id
    and id <> p_offer_id
    and status = 'pending';

  v_sync := public.sync_taxi_shared_ride_driver(v_ride.id, v_driver_id);

  v_old_status := coalesce(v_ride.status, 'dispatching');

  perform public.log_taxi_event(
    v_ride.id,
    'driver_accepted',
    v_old_status,
    'accepted',
    v_driver_id,
    'driver',
    'Driver accepted taxi offer',
    jsonb_build_object(
      'offer_id', p_offer_id,
      'vehicle_id', v_vehicle_id,
      'fuel_type', v_fuel,
      'vehicle_plate', v_vehicle.license_plate,
      'shared_sync', v_sync
    )
  );

  return jsonb_build_object(
    'ok', true,
    'taxi_ride_id', v_ride.id,
    'vehicle_id', v_vehicle_id,
    'is_green_vehicle', v_is_green,
    'vehicle_plate', v_vehicle.license_plate
  );
end;
$$;

revoke all on function public.driver_accept_taxi_offer(uuid) from public;
grant execute on function public.driver_accept_taxi_offer(uuid) to authenticated;
grant execute on function public.driver_accept_taxi_offer(uuid) to service_role;

commit;
