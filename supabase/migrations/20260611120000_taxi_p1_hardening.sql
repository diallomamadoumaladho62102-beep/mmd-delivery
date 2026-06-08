-- Taxi P1 hardening: active ride guard on driver accept

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
  v_old_status text;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  if exists (
    select 1
    from public.taxi_rides tr
    where tr.driver_id = v_driver_id
      and lower(coalesce(tr.status, '')) in (
        'accepted',
        'driver_arrived',
        'in_progress',
        'dispatching'
      )
  ) then
    return jsonb_build_object(
      'ok', false,
      'message', 'driver_already_has_active_taxi_ride'
    );
  end if;

  select *
  into v_offer
  from public.taxi_offers
  where id = p_offer_id
    and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'offer_not_found');
  end if;

  select *
  into v_ride
  from public.taxi_rides
  where id = v_offer.taxi_ride_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_not_found');
  end if;

  if not public.is_taxi_driver_eligible(v_driver_id, v_ride.vehicle_class) then
    return jsonb_build_object('ok', false, 'message', 'driver_not_eligible');
  end if;

  if v_offer.status <> 'pending' or v_offer.expires_at <= now() then
    return jsonb_build_object('ok', false, 'message', 'offer_not_available');
  end if;

  if lower(coalesce(v_ride.payment_status, '')) <> 'paid' then
    return jsonb_build_object('ok', false, 'message', 'ride_not_paid');
  end if;

  if v_ride.driver_id is not null and v_ride.driver_id <> v_driver_id then
    return jsonb_build_object('ok', false, 'message', 'already_assigned');
  end if;

  if lower(coalesce(v_ride.status, '')) not in ('paid', 'dispatching') then
    return jsonb_build_object('ok', false, 'message', 'ride_not_available');
  end if;

  v_old_status := v_ride.status;

  update public.taxi_rides
  set
    driver_id = v_driver_id,
    status = 'accepted',
    accepted_at = coalesce(accepted_at, now()),
    updated_at = now()
  where id = v_ride.id
    and driver_id is null
    and lower(payment_status) = 'paid'
    and lower(status) in ('paid', 'dispatching');

  if not found then
    return jsonb_build_object('ok', false, 'message', 'ride_no_longer_available');
  end if;

  update public.taxi_offers
  set status = 'accepted', updated_at = now()
  where id = v_offer.id;

  update public.taxi_offers
  set status = 'superseded', updated_at = now()
  where taxi_ride_id = v_offer.taxi_ride_id
    and id <> v_offer.id
    and status = 'pending';

  perform public.log_taxi_event(
    v_ride.id,
    'driver_accepted',
    v_old_status,
    'accepted',
    v_driver_id,
    'driver',
    'Driver accepted taxi offer',
    jsonb_build_object('offer_id', p_offer_id)
  );

  return jsonb_build_object('ok', true, 'taxi_ride_id', v_ride.id);
end;
$$;
