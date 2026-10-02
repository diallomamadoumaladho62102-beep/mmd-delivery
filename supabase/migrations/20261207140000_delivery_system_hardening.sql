-- Additive delivery-system hardening. Does not enable flags, payments, or backfill.

create or replace function public.driver_integrity_is_excluded(
  p_entity_type text,
  p_entity_id uuid,
  p_driver_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.driver_integrity_reassignment_exclusions e
    where e.entity_type = p_entity_type
      and e.entity_id = p_entity_id
      and e.driver_id = p_driver_id
  );
$$;

revoke all on function public.driver_integrity_is_excluded(text, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.driver_integrity_is_excluded(text, uuid, uuid)
  to service_role;

create table if not exists public.driver_integrity_scan_cursors (
  entity_type text primary key
    check (entity_type in ('order', 'delivery_request', 'marketplace_job')),
  last_accepted_at timestamptz,
  last_id uuid,
  updated_at timestamptz not null default now()
);

alter table public.driver_integrity_scan_cursors enable row level security;

drop policy if exists driver_integrity_scan_cursors_staff_read
  on public.driver_integrity_scan_cursors;
create policy driver_integrity_scan_cursors_staff_read
  on public.driver_integrity_scan_cursors for select
  to authenticated
  using (public.is_staff_user(auth.uid()));

grant select on public.driver_integrity_scan_cursors to authenticated;

-- Food offer accept: exclusion after order lock
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
  v_count integer;
  v_max integer;
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

  perform pg_advisory_xact_lock(hashtext('delivery_capacity:' || v_driver_id::text));

  select max_active_delivery_missions into v_max
  from public.driver_capacity_settings where singleton = true;
  v_max := coalesce(v_max, 3);
  v_count := public.driver_active_delivery_mission_count(v_driver_id);
  if v_count >= v_max then
    return jsonb_build_object(
      'ok', false,
      'message', 'mission_capacity_reached',
      'active_missions', v_count,
      'max_missions', v_max
    );
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

  if public.driver_integrity_is_excluded('order', v_order.id, v_driver_id) then
    return jsonb_build_object('ok', false, 'message', 'driver_excluded');
  end if;

  if coalesce(lower(v_order.kind::text), '') <> 'food' then
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

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'active_missions', v_count + 1,
    'max_missions', v_max,
    'stack_label', format('Stacked delivery %s of %s', v_count + 1, v_max)
  );
end;
$$;

revoke all on function public.driver_accept_order_offer(uuid) from public;
grant execute on function public.driver_accept_order_offer(uuid) to authenticated;
grant execute on function public.driver_accept_order_offer(uuid) to service_role;

-- Ready-order fallback: same gates as offer accept
create or replace function public.driver_accept_ready_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_order public.orders%rowtype;
  v_count integer;
  v_max integer;
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

  perform pg_advisory_xact_lock(hashtext('delivery_capacity:' || v_driver_id::text));

  select max_active_delivery_missions into v_max
  from public.driver_capacity_settings where singleton = true;
  v_max := coalesce(v_max, 3);
  v_count := public.driver_active_delivery_mission_count(v_driver_id);
  if v_count >= v_max then
    return jsonb_build_object(
      'ok', false,
      'message', 'mission_capacity_reached',
      'active_missions', v_count,
      'max_missions', v_max
    );
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'message', 'order_not_found');
  end if;

  if public.driver_integrity_is_excluded('order', v_order.id, v_driver_id) then
    return jsonb_build_object('ok', false, 'message', 'driver_excluded');
  end if;

  if coalesce(lower(v_order.kind::text), '') <> 'food' then
    return jsonb_build_object('ok', false, 'message', 'invalid_order_kind');
  end if;

  if coalesce(lower(v_order.payment_status), '') <> 'paid' then
    return jsonb_build_object('ok', false, 'message', 'order_not_paid');
  end if;

  if coalesce(lower(v_order.status), '') <> 'ready' then
    return jsonb_build_object('ok', false, 'message', 'order_not_ready');
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

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'active_missions', v_count + 1,
    'max_missions', v_max
  );
end;
$$;

revoke all on function public.driver_accept_ready_order(uuid) from public;
grant execute on function public.driver_accept_ready_order(uuid) to authenticated;
grant execute on function public.driver_accept_ready_order(uuid) to service_role;

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
  v_count integer;
  v_max integer;
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

  perform pg_advisory_xact_lock(hashtext('delivery_capacity:' || v_driver_id::text));

  select max_active_delivery_missions into v_max
  from public.driver_capacity_settings where singleton = true;
  v_max := coalesce(v_max, 3);
  v_count := public.driver_active_delivery_mission_count(v_driver_id);
  if v_count >= v_max then
    return jsonb_build_object(
      'ok', false,
      'message', 'mission_capacity_reached',
      'active_missions', v_count,
      'max_missions', v_max
    );
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

  if public.driver_integrity_is_excluded('delivery_request', v_request.id, v_driver_id) then
    return jsonb_build_object('ok', false, 'message', 'driver_excluded');
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

  return jsonb_build_object(
    'ok', true,
    'delivery_request_id', v_request.id,
    'active_missions', v_count + 1,
    'max_missions', v_max,
    'stack_label', format('Stacked delivery %s of %s', v_count + 1, v_max)
  );
end;
$$;

revoke all on function public.driver_accept_delivery_request_offer(uuid) from public;
grant execute on function public.driver_accept_delivery_request_offer(uuid) to authenticated;
grant execute on function public.driver_accept_delivery_request_offer(uuid) to service_role;

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

  if public.driver_integrity_is_excluded('delivery_request', p_request_id, v_driver_id) then
    return jsonb_build_object('ok', false, 'message', 'driver_excluded');
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
grant execute on function public.driver_accept_delivery_request(uuid) to service_role;

-- Pickup only after dispatched (never while still restaurant-ready)
create or replace function public.confirm_order_pickup(
  p_order_id uuid,
  p_driver_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_jwt_role text := coalesce(auth.jwt() ->> 'role', '');
begin
  if v_jwt_role = 'service_role' then
    v_actor := coalesce(p_driver_user_id, auth.uid());
  else
    v_actor := auth.uid();
    if v_actor is null then
      return jsonb_build_object('ok', false, 'error', 'not_authenticated');
    end if;
    if p_driver_user_id is not null and p_driver_user_id <> v_actor then
      return jsonb_build_object('ok', false, 'error', 'forbidden_impersonation');
    end if;
  end if;

  if v_actor is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  update public.orders
  set
    status = 'picked_up',
    picked_up_at = coalesce(picked_up_at, now()),
    updated_at = now()
  where id = p_order_id
    and driver_id = v_actor
    and lower(coalesce(status, '')) = 'dispatched';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'pickup_not_allowed');
  end if;

  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'status', 'picked_up');
end;
$$;

revoke all on function public.confirm_order_pickup(uuid, uuid) from public;
revoke execute on function public.confirm_order_pickup(uuid, uuid) from authenticated, anon;
grant execute on function public.confirm_order_pickup(uuid, uuid) to service_role;
