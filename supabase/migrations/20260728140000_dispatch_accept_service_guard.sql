-- Defense-in-depth: block accept-offer RPCs when driver service preference no longer matches.

create or replace function public.driver_accept_order_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_offer public.driver_order_offers%rowtype;
  v_order public.orders%rowtype;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  if not public.is_driver_operational(v_driver_id) then
    return jsonb_build_object('ok', false, 'message', 'driver_not_eligible');
  end if;

  if not public.is_driver_service_enabled(v_driver_id, 'food') then
    return jsonb_build_object('ok', false, 'message', 'food_service_disabled');
  end if;

  select *
  into v_offer
  from public.driver_order_offers
  where id = p_offer_id
    and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'offer_not_found');
  end if;

  if v_offer.status <> 'pending' or v_offer.expires_at <= now() then
    return jsonb_build_object('ok', false, 'message', 'offer_not_available');
  end if;

  select *
  into v_order
  from public.orders
  where id = v_offer.order_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'order_not_found');
  end if;

  if coalesce(lower(v_order.kind), '') <> 'food' then
    return jsonb_build_object('ok', false, 'message', 'invalid_order_kind');
  end if;

  if coalesce(lower(v_order.payment_status), '') <> 'paid' then
    return jsonb_build_object('ok', false, 'message', 'order_not_paid');
  end if;

  if coalesce(lower(v_order.status), '') <> 'ready' then
    return jsonb_build_object('ok', false, 'message', 'order_not_ready');
  end if;

  if v_order.driver_id is not null and v_order.driver_id <> v_driver_id then
    return jsonb_build_object('ok', false, 'message', 'already_assigned');
  end if;

  update public.orders
  set
    driver_id = v_driver_id,
    status = 'dispatched',
    updated_at = now()
  where id = v_order.id
    and driver_id is null
    and lower(status) = 'ready';

  if not found then
    return jsonb_build_object('ok', false, 'message', 'order_no_longer_available');
  end if;

  update public.driver_order_offers
  set status = 'accepted', updated_at = now()
  where id = v_offer.id;

  update public.driver_order_offers
  set status = 'superseded', updated_at = now()
  where order_id = v_offer.order_id
    and id <> v_offer.id
    and status = 'pending';

  return jsonb_build_object('ok', true, 'order_id', v_order.id);
end;
$$;

create or replace function public.driver_accept_delivery_request_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_offer public.delivery_request_driver_offers%rowtype;
  v_request public.delivery_requests%rowtype;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  if not public.is_driver_operational(v_driver_id) then
    return jsonb_build_object('ok', false, 'message', 'driver_not_eligible');
  end if;

  if not public.is_driver_service_enabled(v_driver_id, 'package') then
    return jsonb_build_object('ok', false, 'message', 'package_service_disabled');
  end if;

  select *
  into v_offer
  from public.delivery_request_driver_offers
  where id = p_offer_id
    and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'offer_not_found');
  end if;

  if v_offer.status <> 'pending' or v_offer.expires_at <= now() then
    return jsonb_build_object('ok', false, 'message', 'offer_not_available');
  end if;

  select *
  into v_request
  from public.delivery_requests
  where id = v_offer.delivery_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'request_not_found');
  end if;

  if coalesce(lower(v_request.payment_status), '') <> 'paid' then
    return jsonb_build_object('ok', false, 'message', 'request_not_paid');
  end if;

  if v_request.driver_id is not null and v_request.driver_id <> v_driver_id then
    return jsonb_build_object('ok', false, 'message', 'already_assigned');
  end if;

  if lower(coalesce(v_request.status, '')) not in (
    'pending',
    'paid_pending',
    'processing_pending'
  ) then
    return jsonb_build_object('ok', false, 'message', 'request_not_available');
  end if;

  perform public.ensure_delivery_request_codes(v_request.id);

  update public.delivery_requests
  set
    driver_id = v_driver_id,
    status = 'dispatched',
    updated_at = now()
  where id = v_request.id
    and driver_id is null
    and coalesce(payment_status, '') = 'paid'
    and lower(status) in ('pending', 'paid_pending', 'processing_pending');

  if not found then
    return jsonb_build_object('ok', false, 'message', 'request_no_longer_available');
  end if;

  update public.delivery_request_driver_offers
  set status = 'accepted', updated_at = now()
  where id = v_offer.id;

  update public.delivery_request_driver_offers
  set status = 'superseded', updated_at = now()
  where delivery_request_id = v_offer.delivery_request_id
    and id <> v_offer.id
    and status = 'pending';

  return jsonb_build_object('ok', true, 'delivery_request_id', v_request.id);
end;
$$;

revoke all on function public.driver_accept_order_offer(uuid) from public;
revoke all on function public.driver_accept_delivery_request_offer(uuid) from public;
grant execute on function public.driver_accept_order_offer(uuid) to authenticated;
grant execute on function public.driver_accept_delivery_request_offer(uuid) to authenticated;
