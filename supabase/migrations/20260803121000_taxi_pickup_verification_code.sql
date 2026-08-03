-- Taxi pickup boarding verification (OTP/PIN) — replaces any photo-at-pickup expectation.
-- Driver enters the client-visible 4-digit code to start the ride.

alter table public.taxi_rides
  add column if not exists pickup_verification_code text;

comment on column public.taxi_rides.pickup_verification_code is
  '4-digit boarding code shown to the client; required for driver_start_taxi_ride.';

create or replace function public.taxi_generate_pickup_verification_code()
returns text
language sql
volatile
as $$
  select lpad((floor(random() * 10000))::int::text, 4, '0');
$$;

create or replace function public.taxi_rides_assign_pickup_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.pickup_verification_code is null
     and lower(coalesce(new.status, '')) in ('accepted', 'driver_arrived', 'in_progress') then
    new.pickup_verification_code := public.taxi_generate_pickup_verification_code();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_taxi_rides_assign_pickup_code on public.taxi_rides;
create trigger trg_taxi_rides_assign_pickup_code
  before insert or update of status on public.taxi_rides
  for each row
  execute function public.taxi_rides_assign_pickup_code();

-- Backfill active rides missing a code
update public.taxi_rides
set pickup_verification_code = public.taxi_generate_pickup_verification_code()
where pickup_verification_code is null
  and lower(coalesce(status, '')) in ('accepted', 'driver_arrived', 'in_progress');

create or replace function public.driver_start_taxi_ride(
  p_ride_id uuid,
  p_pickup_code text default null
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
  v_code text := regexp_replace(coalesce(p_pickup_code, ''), '\D', '', 'g');
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

  if not public.is_taxi_driver_eligible(v_driver_id, v_ride.vehicle_class) then
    return jsonb_build_object('ok', false, 'message', 'driver_not_eligible');
  end if;

  if lower(coalesce(v_ride.status, '')) <> 'driver_arrived' then
    return jsonb_build_object('ok', false, 'message', 'invalid_status');
  end if;

  if v_ride.pickup_verification_code is null then
    update public.taxi_rides
    set pickup_verification_code = public.taxi_generate_pickup_verification_code()
    where id = p_ride_id
    returning * into v_ride;
  end if;

  if length(v_code) <> 4 or v_code <> v_ride.pickup_verification_code then
    return jsonb_build_object('ok', false, 'message', 'invalid_pickup_code');
  end if;

  v_old_status := v_ride.status;

  update public.taxi_rides
  set
    status = 'in_progress',
    started_at = coalesce(started_at, now()),
    updated_at = now()
  where id = p_ride_id
    and driver_id = v_driver_id
    and status = v_ride.status;

  perform public.log_taxi_event(
    p_ride_id,
    'ride_started',
    v_old_status,
    'in_progress',
    v_driver_id,
    'driver',
    'Taxi ride started after pickup code verification',
    jsonb_build_object('pickup_code_verified', true)
  );

  return jsonb_build_object('ok', true, 'taxi_ride_id', p_ride_id, 'status', 'in_progress');
end;
$$;

revoke all on function public.driver_start_taxi_ride(uuid, text) from public;
grant execute on function public.driver_start_taxi_ride(uuid, text) to authenticated;

-- Keep single-arg overload calling the verified path with null (fails closed).
create or replace function public.driver_start_taxi_ride(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.driver_start_taxi_ride(p_ride_id, null);
end;
$$;

revoke all on function public.driver_start_taxi_ride(uuid) from public;
grant execute on function public.driver_start_taxi_ride(uuid) to authenticated;
