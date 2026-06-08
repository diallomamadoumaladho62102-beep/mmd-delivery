-- Final security before Taxi: block non-operational drivers on all accept RPC paths.

begin;

-- Guard: is_driver_operational must exist (from driver P0 migration).
do $guard$
begin
  if to_regprocedure('public.is_driver_operational(uuid)') is null then
    raise exception 'is_driver_operational(uuid) is required before applying final security migration';
  end if;
end
$guard$;

-- ---------------------------------------------------------------------------
-- driver_accept_ready_order (legacy direct accept)
-- ---------------------------------------------------------------------------

drop function if exists public.driver_accept_ready_order(uuid);

create or replace function public.driver_accept_ready_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  if not public.is_driver_operational(v_driver_id) then
    return jsonb_build_object('ok', false, 'message', 'driver_not_eligible');
  end if;

  update public.orders
  set
    driver_id = v_driver_id,
    status = 'dispatched',
    updated_at = now()
  where id = p_order_id
    and driver_id is null
    and lower(coalesce(payment_status, '')) = 'paid'
    and lower(coalesce(status, '')) = 'ready';

  if not found then
    return jsonb_build_object('ok', false, 'message', 'order_not_available');
  end if;

  insert into public.order_members (order_id, user_id, role)
  values (p_order_id, v_driver_id, 'driver')
  on conflict (order_id, user_id) do update set role = 'driver';

  return jsonb_build_object('ok', true, 'order_id', p_order_id);
end;
$$;

revoke all on function public.driver_accept_ready_order(uuid) from public;
grant execute on function public.driver_accept_ready_order(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- driver_accept_delivery_request (legacy direct accept)
-- ---------------------------------------------------------------------------

drop function if exists public.driver_accept_delivery_request(uuid);

create or replace function public.driver_accept_delivery_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  if not public.is_driver_operational(v_driver_id) then
    return jsonb_build_object('ok', false, 'message', 'driver_not_eligible');
  end if;

  perform public.ensure_delivery_request_codes(p_request_id);

  update public.delivery_requests
  set
    driver_id = v_driver_id,
    status = 'dispatched',
    updated_at = now()
  where id = p_request_id
    and coalesce(payment_status, '') = 'paid'
    and driver_id is null
    and lower(status) in ('pending', 'paid_pending', 'processing_pending');

  if not found then
    return jsonb_build_object('ok', false, 'message', 'request_not_available');
  end if;

  return jsonb_build_object('ok', true, 'delivery_request_id', p_request_id);
end;
$$;

revoke all on function public.driver_accept_delivery_request(uuid) from public;
grant execute on function public.driver_accept_delivery_request(uuid) to authenticated;

commit;
