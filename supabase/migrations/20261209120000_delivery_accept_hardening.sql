-- Harden leftover package accept RPC and isolate package mirror orders from MP trip time.
-- Standard Method formulas and fleet allocation stay unchanged.

create or replace function public.driver_accept_delivery_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_offer public.delivery_request_driver_offers%rowtype;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  select *
  into v_offer
  from public.delivery_request_driver_offers
  where delivery_request_id = p_request_id
    and driver_id = v_driver_id
    and status = 'pending'
    and expires_at > now()
  order by created_at desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'offer_required');
  end if;

  return public.driver_accept_delivery_request_offer(v_offer.id);
end;
$$;

revoke all on function public.driver_accept_delivery_request(uuid) from public;
grant execute on function public.driver_accept_delivery_request(uuid) to authenticated;
grant execute on function public.driver_accept_delivery_request(uuid) to service_role;

create or replace function public.minimum_pay_sync_order_trip()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_end timestamptz;
  v_reason text;
begin
  if new.driver_accepted_at is null or new.driver_id is null then
    return new;
  end if;
  if coalesce(new.is_test, false) = true or new.archived_at is not null then
    return new;
  end if;
  -- Package SCT mirror orders are not a second legal trip. The DR trigger owns that interval.
  if coalesce(new.external_ref_type, '') = 'delivery_request' then
    return new;
  end if;
  if new.delivered_at is not null or new.delivered_confirmed_at is not null then
    v_end := coalesce(new.delivered_at, new.delivered_confirmed_at);
    v_reason := 'completed';
  elsif new.cancelled_at is not null or lower(coalesce(new.status, '')) in ('canceled', 'cancelled') then
    v_end := coalesce(new.cancelled_at, now());
    v_reason := 'cancelled';
  end if;
  perform public.minimum_pay_sync_trip_interval(
    'order', new.id, new.driver_id, new.driver_accepted_at, v_end, v_reason
  );
  return new;
end;
$$;
