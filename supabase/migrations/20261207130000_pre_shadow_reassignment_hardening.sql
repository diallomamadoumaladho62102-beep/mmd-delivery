-- Additive pre-shadow hardening:
-- 1) Persist reassignment exclusions for orders and delivery requests
--    (marketplace already writes them in 20261207120000).
-- 2) Driver wait/dispute inserts go through service_role HTTP APIs only.
-- Does not enable flags, payments, backfill, or rewrite historical rows.

drop policy if exists driver_wait_reasons_driver_insert
  on public.driver_wait_reasons;
drop policy if exists driver_trip_disputes_driver_insert
  on public.driver_trip_disputes;

create or replace function public.driver_integrity_reassign_order(
  p_order_id uuid,
  p_expected_driver_id uuid,
  p_incident_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_settings public.driver_integrity_settings%rowtype;
  v_order public.orders%rowtype;
  v_incident public.driver_integrity_incidents%rowtype;
  v_accepted timestamptz;
begin
  select * into v_settings
  from public.driver_integrity_settings
  where singleton = true;
  if not found
     or v_settings.monitoring_enabled is not true
     or v_settings.reassignment_enabled is not true then
    return jsonb_build_object('ok', false, 'message', 'reassignment_disabled');
  end if;

  select * into v_incident
  from public.driver_integrity_incidents
  where id = p_incident_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'incident_not_found');
  end if;
  if v_incident.reassigned_at is not null then
    return jsonb_build_object(
      'ok', true,
      'message', 'already_reassigned',
      'idempotent', true,
      'order_id', p_order_id,
      'original_driver_id', v_incident.original_driver_id,
      'original_driver_accepted_at', v_incident.original_driver_accepted_at
    );
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'order_not_found');
  end if;

  if v_order.driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'missing_assignment');
  end if;
  if v_order.driver_id is distinct from p_expected_driver_id then
    return jsonb_build_object('ok', false, 'message', 'driver_mismatch');
  end if;
  if v_order.picked_up_at is not null then
    return jsonb_build_object('ok', false, 'message', 'already_picked_up');
  end if;
  if v_order.delivered_at is not null
     or v_order.delivered_confirmed_at is not null then
    return jsonb_build_object('ok', false, 'message', 'already_delivered');
  end if;
  if v_order.cancelled_at is not null
     or lower(coalesce(v_order.status, '')) in ('canceled', 'cancelled') then
    return jsonb_build_object('ok', false, 'message', 'already_cancelled');
  end if;
  if lower(coalesce(v_order.status, '')) <> 'dispatched' then
    return jsonb_build_object('ok', false, 'message', 'stale_state');
  end if;

  v_accepted := coalesce(v_order.driver_accepted_at, v_incident.original_driver_accepted_at);

  update public.orders
  set
    driver_id = null,
    status = 'ready',
    updated_at = now()
  where id = p_order_id
    and driver_id = p_expected_driver_id
    and picked_up_at is null
    and delivered_at is null
    and cancelled_at is null
    and lower(status) = 'dispatched';

  if not found then
    return jsonb_build_object('ok', false, 'message', 'concurrent_assignment');
  end if;

  update public.driver_order_offers
  set status = 'expired', updated_at = now()
  where order_id = p_order_id
    and status = 'pending';

  insert into public.driver_integrity_reassignment_exclusions (
    entity_type, entity_id, driver_id, incident_id
  )
  values ('order', p_order_id, p_expected_driver_id, p_incident_id)
  on conflict (entity_type, entity_id, driver_id) do nothing;

  update public.driver_integrity_incidents
  set
    status = 'reassigned',
    reassigned_at = now(),
    reassigned_by = 'system',
    updated_at = now()
  where id = p_incident_id
    and reassigned_at is null;

  insert into public.driver_integrity_events (incident_id, event_type, payload)
  values (
    p_incident_id,
    'DRIVER_ORDER_REASSIGNED',
    jsonb_build_object(
      'order_id', p_order_id,
      'original_driver_id', p_expected_driver_id,
      'original_driver_accepted_at', v_accepted,
      'preserved_driver_accepted_at', true
    )
  );

  return jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'original_driver_id', p_expected_driver_id,
    'original_driver_accepted_at', v_accepted,
    'idempotent', false
  );
end;
$$;

create or replace function public.driver_integrity_reassign_delivery_request(
  p_request_id uuid,
  p_expected_driver_id uuid,
  p_incident_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_settings public.driver_integrity_settings%rowtype;
  v_req public.delivery_requests%rowtype;
  v_incident public.driver_integrity_incidents%rowtype;
  v_accepted timestamptz;
begin
  select * into v_settings
  from public.driver_integrity_settings
  where singleton = true;
  if not found
     or v_settings.monitoring_enabled is not true
     or v_settings.reassignment_enabled is not true then
    return jsonb_build_object('ok', false, 'message', 'reassignment_disabled');
  end if;

  select * into v_incident
  from public.driver_integrity_incidents
  where id = p_incident_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'incident_not_found');
  end if;
  if v_incident.reassigned_at is not null then
    return jsonb_build_object(
      'ok', true,
      'message', 'already_reassigned',
      'idempotent', true,
      'delivery_request_id', p_request_id,
      'original_driver_id', v_incident.original_driver_id,
      'original_driver_accepted_at', v_incident.original_driver_accepted_at
    );
  end if;

  select * into v_req
  from public.delivery_requests
  where id = p_request_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'message', 'request_not_found');
  end if;
  if v_req.driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'missing_assignment');
  end if;
  if v_req.driver_id is distinct from p_expected_driver_id then
    return jsonb_build_object('ok', false, 'message', 'driver_mismatch');
  end if;
  if v_req.picked_up_at is not null then
    return jsonb_build_object('ok', false, 'message', 'already_picked_up');
  end if;
  if v_req.delivered_at is not null then
    return jsonb_build_object('ok', false, 'message', 'already_delivered');
  end if;
  if v_req.cancelled_at is not null
     or lower(coalesce(v_req.status, '')) in ('canceled', 'cancelled') then
    return jsonb_build_object('ok', false, 'message', 'already_cancelled');
  end if;
  if lower(coalesce(v_req.status, '')) <> 'dispatched' then
    return jsonb_build_object('ok', false, 'message', 'stale_state');
  end if;

  v_accepted := coalesce(v_req.driver_accepted_at, v_incident.original_driver_accepted_at);

  update public.delivery_requests
  set
    driver_id = null,
    status = 'pending',
    updated_at = now()
  where id = p_request_id
    and driver_id = p_expected_driver_id
    and picked_up_at is null
    and delivered_at is null
    and cancelled_at is null
    and lower(status) = 'dispatched';

  if not found then
    return jsonb_build_object('ok', false, 'message', 'concurrent_assignment');
  end if;

  update public.delivery_request_driver_offers
  set status = 'expired', updated_at = now()
  where delivery_request_id = p_request_id
    and status = 'pending';

  insert into public.driver_integrity_reassignment_exclusions (
    entity_type, entity_id, driver_id, incident_id
  )
  values ('delivery_request', p_request_id, p_expected_driver_id, p_incident_id)
  on conflict (entity_type, entity_id, driver_id) do nothing;

  update public.driver_integrity_incidents
  set
    status = 'reassigned',
    reassigned_at = now(),
    reassigned_by = 'system',
    updated_at = now()
  where id = p_incident_id
    and reassigned_at is null;

  insert into public.driver_integrity_events (incident_id, event_type, payload)
  values (
    p_incident_id,
    'DRIVER_ORDER_REASSIGNED',
    jsonb_build_object(
      'delivery_request_id', p_request_id,
      'original_driver_id', p_expected_driver_id,
      'original_driver_accepted_at', v_accepted,
      'preserved_driver_accepted_at', true
    )
  );

  return jsonb_build_object(
    'ok', true,
    'delivery_request_id', p_request_id,
    'original_driver_id', p_expected_driver_id,
    'original_driver_accepted_at', v_accepted,
    'idempotent', false
  );
end;
$$;

revoke all on function public.driver_integrity_reassign_order(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.driver_integrity_reassign_delivery_request(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.driver_integrity_reassign_order(uuid, uuid, uuid)
  to service_role;
grant execute on function public.driver_integrity_reassign_delivery_request(uuid, uuid, uuid)
  to service_role;
