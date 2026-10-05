-- Forward remediation for offer visibility, food accept, delivery lifecycle,
-- join_order authorization, code column privacy, and related RLS.

begin;

-- ---------------------------------------------------------------------------
-- 1) Live offer read helpers (caller can only ask about themselves)
-- ---------------------------------------------------------------------------

create or replace function public.driver_has_live_order_offer(
  p_order_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_order_id is null or p_user_id is null or p_user_id is distinct from auth.uid() then
    return false;
  end if;

  return exists (
    select 1
    from public.driver_order_offers o
    where o.order_id = p_order_id
      and o.driver_id = p_user_id
      and o.status = 'pending'
      and o.expires_at > now()
  );
end;
$$;

create or replace function public.driver_has_live_delivery_offer(
  p_request_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_request_id is null or p_user_id is null or p_user_id is distinct from auth.uid() then
    return false;
  end if;

  return exists (
    select 1
    from public.delivery_request_driver_offers o
    where o.delivery_request_id = p_request_id
      and o.driver_id = p_user_id
      and o.status = 'pending'
      and o.expires_at > now()
  );
end;
$$;

create or replace function public.driver_has_live_taxi_offer(
  p_ride_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_ride_id is null or p_user_id is null or p_user_id is distinct from auth.uid() then
    return false;
  end if;

  return exists (
    select 1
    from public.taxi_offers o
    where o.taxi_ride_id = p_ride_id
      and o.driver_id = p_user_id
      and o.status = 'pending'
      and o.expires_at > now()
  );
end;
$$;

revoke all on function public.driver_has_live_order_offer(uuid, uuid) from public;
revoke all on function public.driver_has_live_delivery_offer(uuid, uuid) from public;
revoke all on function public.driver_has_live_taxi_offer(uuid, uuid) from public;
grant execute on function public.driver_has_live_order_offer(uuid, uuid) to authenticated, service_role;
grant execute on function public.driver_has_live_delivery_offer(uuid, uuid) to authenticated, service_role;
grant execute on function public.driver_has_live_taxi_offer(uuid, uuid) to authenticated, service_role;

-- Offered drivers may read the parent job. Expired offers do not. Strangers do not.
drop policy if exists orders_select_participants on public.orders;
create policy orders_select_participants
  on public.orders
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.order_participant_ids(orders.id) p
      where p.user_id = auth.uid()
    )
    or public.driver_has_live_order_offer(orders.id, auth.uid())
  );

drop policy if exists delivery_requests_select_participants on public.delivery_requests;
create policy delivery_requests_select_participants
  on public.delivery_requests
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.delivery_request_participant_ids(delivery_requests.id) p
      where p.user_id = auth.uid()
    )
    or public.driver_has_live_delivery_offer(delivery_requests.id, auth.uid())
  );

drop policy if exists taxi_rides_select_participants on public.taxi_rides;
create policy taxi_rides_select_participants
  on public.taxi_rides
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.taxi_ride_participant_ids(taxi_rides.id) p
      where p.user_id = auth.uid()
    )
    or public.driver_has_live_taxi_offer(taxi_rides.id, auth.uid())
    or public.is_staff_user(auth.uid())
  );

-- ---------------------------------------------------------------------------
-- 2) Food accept-ready cannot bypass a live offer
-- ---------------------------------------------------------------------------

create or replace function public.driver_accept_ready_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_offer_id uuid;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  if p_order_id is null then
    return jsonb_build_object('ok', false, 'message', 'missing_order_id');
  end if;

  select o.id
  into v_offer_id
  from public.driver_order_offers o
  where o.order_id = p_order_id
    and o.driver_id = v_driver_id
    and o.status = 'pending'
    and o.expires_at > now()
  order by o.created_at desc
  limit 1;

  if v_offer_id is null then
    return jsonb_build_object('ok', false, 'message', 'offer_required');
  end if;

  return public.driver_accept_order_offer(v_offer_id);
end;
$$;

revoke all on function public.driver_accept_ready_order(uuid) from public;
grant execute on function public.driver_accept_ready_order(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) Pickup arrival + delivery cannot skip picked_up
-- ---------------------------------------------------------------------------

create or replace function public.delivery_pickup_arrival_recorded(
  p_entity_type text,
  p_entity_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.wait_timer_events e
    where e.entity_id = p_entity_id
      and e.event_type = 'driver_arrived_pickup'
      and lower(coalesce(e.entity_type, '')) = lower(coalesce(p_entity_type, ''))
  );
$$;

revoke all on function public.delivery_pickup_arrival_recorded(text, uuid) from public;
revoke execute on function public.delivery_pickup_arrival_recorded(text, uuid) from authenticated, anon;
grant execute on function public.delivery_pickup_arrival_recorded(text, uuid) to service_role;

alter table public.orders
  add column if not exists driver_arrived_at timestamptz;

alter table public.delivery_requests
  add column if not exists driver_arrived_at timestamptz;

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
  v_status text;
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

  select lower(coalesce(status, ''))
  into v_status
  from public.orders
  where id = p_order_id
    and driver_id = v_actor;

  if v_status is null then
    return jsonb_build_object('ok', false, 'error', 'pickup_not_allowed');
  end if;

  if v_status = 'picked_up' then
    return jsonb_build_object('ok', true, 'order_id', p_order_id, 'status', 'picked_up', 'already_picked_up', true);
  end if;

  if v_status <> 'dispatched' then
    return jsonb_build_object('ok', false, 'error', 'pickup_not_allowed');
  end if;

  if not public.delivery_pickup_arrival_recorded('order', p_order_id) then
    return jsonb_build_object('ok', false, 'error', 'pickup_arrival_required');
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

create or replace function public.confirm_order_delivery(
  p_order_id uuid,
  p_owner_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid;
  v_jwt_role text := coalesce(auth.jwt() ->> 'role', '');
  v_status text;
  v_arrived timestamptz;
begin
  if v_jwt_role = 'service_role' then
    v_actor := coalesce(p_owner_user_id, auth.uid());
  else
    v_actor := auth.uid();
    if v_actor is null then
      return jsonb_build_object('ok', false, 'error', 'not_authenticated');
    end if;
    if p_owner_user_id is not null and p_owner_user_id <> v_actor then
      return jsonb_build_object('ok', false, 'error', 'forbidden_impersonation');
    end if;
  end if;

  if v_actor is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select lower(coalesce(status, '')), driver_arrived_at
  into v_status, v_arrived
  from public.orders
  where id = p_order_id
    and driver_id = v_actor;

  if v_status is null then
    return jsonb_build_object('ok', false, 'error', 'delivery_not_allowed');
  end if;

  if v_status = 'delivered' then
    return jsonb_build_object('ok', true, 'order_id', p_order_id, 'status', 'delivered', 'already_delivered', true);
  end if;

  if v_status <> 'picked_up' then
    return jsonb_build_object('ok', false, 'error', 'delivery_not_allowed');
  end if;

  if v_arrived is null then
    return jsonb_build_object('ok', false, 'error', 'customer_arrival_required');
  end if;

  update public.orders
  set
    status = 'delivered',
    delivered_at = coalesce(delivered_at, now()),
    delivered_confirmed_at = coalesce(delivered_confirmed_at, now()),
    updated_at = now()
  where id = p_order_id
    and driver_id = v_actor
    and lower(coalesce(status, '')) = 'picked_up';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'delivery_not_allowed');
  end if;

  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'status', 'delivered');
end;
$$;

revoke all on function public.confirm_order_delivery(uuid, uuid) from public;
revoke execute on function public.confirm_order_delivery(uuid, uuid) from authenticated, anon;
grant execute on function public.confirm_order_delivery(uuid, uuid) to service_role;

create table if not exists public.verification_code_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  entity_id uuid not null,
  code_type text not null,
  created_at timestamptz not null default now()
);

create index if not exists verification_code_attempts_lookup_idx
  on public.verification_code_attempts (user_id, entity_id, code_type, created_at desc);

alter table public.verification_code_attempts enable row level security;
revoke all on table public.verification_code_attempts from public, anon, authenticated;

create or replace function public.verification_attempt_blocked(
  p_user uuid,
  p_entity uuid,
  p_kind text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select count(*) >= 8
  from public.verification_code_attempts a
  where a.user_id = p_user
    and a.entity_id = p_entity
    and a.code_type = p_kind
    and a.created_at > now() - interval '15 minutes';
$$;

create or replace function public.verification_attempt_record(
  p_user uuid,
  p_entity uuid,
  p_kind text
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.verification_code_attempts (user_id, entity_id, code_type)
  values (p_user, p_entity, p_kind);
$$;

create or replace function public.verification_attempt_clear(
  p_user uuid,
  p_entity uuid,
  p_kind text
)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.verification_code_attempts
  where user_id = p_user
    and entity_id = p_entity
    and code_type = p_kind;
$$;

revoke all on function public.verification_attempt_blocked(uuid, uuid, text) from public;
revoke all on function public.verification_attempt_record(uuid, uuid, text) from public;
revoke all on function public.verification_attempt_clear(uuid, uuid, text) from public;
grant execute on function public.verification_attempt_blocked(uuid, uuid, text) to service_role;
grant execute on function public.verification_attempt_record(uuid, uuid, text) to service_role;
grant execute on function public.verification_attempt_clear(uuid, uuid, text) to service_role;

create or replace function public.verify_order_code(
  p_order_id uuid,
  p_input_code text,
  p_code_type text default 'pickup'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_row public.orders%rowtype;
  v_expected text;
  v_input text := nullif(trim(p_input_code), '');
  v_kind text := lower(trim(coalesce(p_code_type, 'pickup')));
begin
  if v_driver_id is null then
    return jsonb_build_object('success', false, 'message', 'not_authenticated');
  end if;

  select *
  into v_row
  from public.orders
  where id = p_order_id
    and driver_id = v_driver_id;

  if not found then
    return jsonb_build_object('success', false, 'message', 'order_not_found');
  end if;

  if v_kind = 'dropoff' then
    if lower(coalesce(v_row.status, '')) not in ('picked_up', 'delivered') then
      return jsonb_build_object('success', false, 'message', 'delivery_not_allowed');
    end if;
    v_expected := nullif(trim(v_row.dropoff_code), '');
  else
    if lower(coalesce(v_row.status, '')) not in ('dispatched', 'picked_up') then
      return jsonb_build_object('success', false, 'message', 'pickup_not_allowed');
    end if;
    v_expected := nullif(trim(v_row.pickup_code), '');
  end if;

  if public.verification_attempt_blocked(v_driver_id, p_order_id, v_kind) then
    return jsonb_build_object('success', false, 'message', 'rate_limited');
  end if;

  if v_expected is null then
    return jsonb_build_object('success', false, 'message', 'code_required');
  end if;

  if v_input is null or v_input <> v_expected then
    perform public.verification_attempt_record(v_driver_id, p_order_id, v_kind);
    return jsonb_build_object('success', false, 'message', 'invalid_code');
  end if;

  perform public.verification_attempt_clear(v_driver_id, p_order_id, v_kind);
  return jsonb_build_object('success', true, 'message', 'verified');
end;
$$;

revoke all on function public.verify_order_code(uuid, text, text) from public;
grant execute on function public.verify_order_code(uuid, text, text) to authenticated, service_role;

create or replace function public.confirm_delivery_request_pickup(
  p_request_id uuid,
  p_pickup_code text default null,
  p_proof_photo_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_row public.delivery_requests%rowtype;
  v_expected_code text;
  v_input_code text;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select *
  into v_row
  from public.delivery_requests
  where id = p_request_id
    and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'request_not_found');
  end if;

  if lower(v_row.status) = 'picked_up' then
    return jsonb_build_object('ok', true, 'delivery_request_id', p_request_id, 'status', 'picked_up', 'already_picked_up', true);
  end if;

  if lower(v_row.status) <> 'dispatched' then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  if not public.delivery_pickup_arrival_recorded('delivery_request', p_request_id) then
    return jsonb_build_object('ok', false, 'error', 'pickup_arrival_required');
  end if;

  perform public.ensure_delivery_request_codes(p_request_id);

  select pickup_code
  into v_expected_code
  from public.delivery_requests
  where id = p_request_id;

  v_input_code := nullif(trim(p_pickup_code), '');
  v_expected_code := nullif(trim(v_expected_code), '');

  if public.verification_attempt_blocked(v_driver_id, p_request_id, 'package_pickup') then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  if v_expected_code is null or v_input_code is null or v_input_code <> v_expected_code then
    perform public.verification_attempt_record(v_driver_id, p_request_id, 'package_pickup');
    return jsonb_build_object('ok', false, 'error', 'invalid_pickup_code');
  end if;

  perform public.verification_attempt_clear(v_driver_id, p_request_id, 'package_pickup');

  update public.delivery_requests
  set
    status = 'picked_up',
    picked_up_at = coalesce(picked_up_at, now()),
    pickup_code_verified_at = coalesce(pickup_code_verified_at, now()),
    pickup_photo_url = coalesce(nullif(trim(p_proof_photo_url), ''), pickup_photo_url),
    updated_at = now()
  where id = p_request_id
    and lower(coalesce(status, '')) = 'dispatched';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  return jsonb_build_object('ok', true, 'delivery_request_id', p_request_id, 'status', 'picked_up');
end;
$$;

create or replace function public.confirm_delivery_request_delivery(
  p_request_id uuid,
  p_dropoff_code text default null,
  p_proof_photo_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_row public.delivery_requests%rowtype;
  v_expected_code text;
  v_input_code text;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  select *
  into v_row
  from public.delivery_requests
  where id = p_request_id
    and driver_id = v_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'request_not_found');
  end if;

  if lower(v_row.status) = 'delivered' then
    return jsonb_build_object('ok', true, 'delivery_request_id', p_request_id, 'status', 'delivered', 'already_delivered', true);
  end if;

  if lower(v_row.status) <> 'picked_up' then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  if v_row.driver_arrived_at is null then
    return jsonb_build_object('ok', false, 'error', 'customer_arrival_required');
  end if;

  perform public.ensure_delivery_request_codes(p_request_id);

  select dropoff_code
  into v_expected_code
  from public.delivery_requests
  where id = p_request_id;

  v_input_code := nullif(trim(p_dropoff_code), '');
  v_expected_code := nullif(trim(v_expected_code), '');

  if public.verification_attempt_blocked(v_driver_id, p_request_id, 'package_dropoff') then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;

  if v_expected_code is null or v_input_code is null or v_input_code <> v_expected_code then
    perform public.verification_attempt_record(v_driver_id, p_request_id, 'package_dropoff');
    return jsonb_build_object('ok', false, 'error', 'invalid_dropoff_code');
  end if;

  perform public.verification_attempt_clear(v_driver_id, p_request_id, 'package_dropoff');

  update public.delivery_requests
  set
    status = 'delivered',
    delivered_at = coalesce(delivered_at, now()),
    dropoff_code_verified_at = coalesce(dropoff_code_verified_at, now()),
    dropoff_photo_url = coalesce(nullif(trim(p_proof_photo_url), ''), dropoff_photo_url),
    updated_at = now()
  where id = p_request_id
    and lower(coalesce(status, '')) = 'picked_up';

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_status');
  end if;

  return jsonb_build_object('ok', true, 'delivery_request_id', p_request_id, 'status', 'delivered');
end;
$$;

revoke all on function public.confirm_delivery_request_pickup(uuid, text, text) from public;
revoke all on function public.confirm_delivery_request_delivery(uuid, text, text) from public;
grant execute on function public.confirm_delivery_request_pickup(uuid, text, text) to authenticated, service_role;
grant execute on function public.confirm_delivery_request_delivery(uuid, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) join_order uses the profile role. UUID knowledge is not membership.
-- ---------------------------------------------------------------------------

create or replace function public.join_order(
  p_order_id uuid,
  p_role text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile_role text;
  v_order public.orders%rowtype;
  v_is_owner boolean := false;
  v_already_member boolean := false;
  v_is_restaurant boolean := false;
  v_is_assigned_driver boolean := false;
  v_member_role text;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'missing_order_id');
  end if;

  select lower(trim(coalesce(p.role::text, '')))
  into v_profile_role
  from public.profiles p
  where p.id = v_user_id;

  select *
  into v_order
  from public.orders
  where id = p_order_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'order_not_found');
  end if;

  v_is_owner :=
    v_order.created_by = v_user_id
    or v_order.client_user_id = v_user_id;

  if to_regclass('public.orders') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'user_id'
    ) then
      v_is_owner := v_is_owner or exists (
        select 1 from public.orders o
        where o.id = p_order_id and o.user_id = v_user_id
      );
    end if;
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'orders' and column_name = 'client_id'
    ) then
      v_is_owner := v_is_owner or exists (
        select 1 from public.orders o
        where o.id = p_order_id and o.client_id = v_user_id
      );
    end if;
  end if;

  v_already_member := exists (
    select 1
    from public.order_members om
    where om.order_id = p_order_id
      and om.user_id = v_user_id
  );

  v_is_assigned_driver := v_order.driver_id = v_user_id;

  v_is_restaurant :=
    v_order.restaurant_user_id = v_user_id
    or v_order.restaurant_id = v_user_id;

  if public.is_staff_user(v_user_id) then
    v_member_role := 'admin';
  elsif v_is_owner or (v_profile_role = 'client' and v_already_member) then
    v_member_role := 'client';
  elsif v_profile_role = 'restaurant' and (v_is_restaurant or v_already_member) then
    v_member_role := 'restaurant';
  elsif v_profile_role = 'driver' and (v_is_assigned_driver or v_already_member) then
    v_member_role := 'driver';
  elsif v_already_member then
    v_member_role := coalesce(nullif(v_profile_role, ''), 'client');
  else
    return jsonb_build_object('ok', false, 'error', 'forbidden_client');
  end if;

  if v_member_role = 'client' and not v_is_owner and not v_already_member then
    return jsonb_build_object('ok', false, 'error', 'forbidden_client');
  end if;

  if v_member_role = 'driver' and not v_is_assigned_driver and not v_already_member and not public.is_staff_user(v_user_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden_driver');
  end if;

  if v_member_role = 'restaurant' and not v_is_restaurant and not v_already_member and not public.is_staff_user(v_user_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden_restaurant');
  end if;

  insert into public.order_members (order_id, user_id, role, joined_at)
  values (p_order_id, v_user_id, v_member_role, now())
  on conflict (order_id, user_id) do nothing;

  return jsonb_build_object('ok', true, 'order_id', p_order_id, 'role', v_member_role);
end;
$$;

revoke all on function public.join_order(uuid, text) from public;
grant execute on function public.join_order(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) Verification codes are not readable as table columns
-- ---------------------------------------------------------------------------

create or replace function public.get_authorized_verification_codes(
  p_entity_type text,
  p_entity_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_kind text := lower(trim(coalesce(p_entity_type, '')));
  v_role text;
  v_pickup text;
  v_dropoff text;
  v_owner boolean := false;
  v_restaurant boolean := false;
  v_staff boolean := false;
begin
  if v_user is null or p_entity_id is null then
    return jsonb_build_object('pickup_code', null, 'dropoff_code', null);
  end if;

  select lower(trim(coalesce(role::text, '')))
  into v_role
  from public.profiles
  where id = v_user;

  v_staff := public.is_staff_user(v_user);

  if v_kind in ('taxi', 'taxi_ride', 'taxi_rides') then
    select tr.pickup_verification_code
    into v_pickup
    from public.taxi_rides tr
    where tr.id = p_entity_id
      and (
        v_staff
        or tr.client_user_id = v_user
      );

    return jsonb_build_object('pickup_code', v_pickup, 'dropoff_code', null);
  end if;

  if v_kind in ('delivery_request', 'delivery_requests', 'package') then
    select dr.pickup_code, dr.dropoff_code,
           (dr.client_user_id = v_user or dr.created_by = v_user)
    into v_pickup, v_dropoff, v_owner
    from public.delivery_requests dr
    where dr.id = p_entity_id;

    if v_staff or v_owner then
      return jsonb_build_object('pickup_code', v_pickup, 'dropoff_code', v_dropoff);
    end if;

    return jsonb_build_object('pickup_code', null, 'dropoff_code', null);
  end if;

  select o.pickup_code, o.dropoff_code,
         (o.client_user_id = v_user or o.created_by = v_user),
         (o.restaurant_user_id = v_user or o.restaurant_id = v_user)
  into v_pickup, v_dropoff, v_owner, v_restaurant
  from public.orders o
  where o.id = p_entity_id;

  if v_staff or v_owner then
    return jsonb_build_object('pickup_code', v_pickup, 'dropoff_code', v_dropoff);
  end if;

  if v_role = 'restaurant' and v_restaurant then
    return jsonb_build_object('pickup_code', v_pickup, 'dropoff_code', null);
  end if;

  return jsonb_build_object('pickup_code', null, 'dropoff_code', null);
end;
$$;

revoke all on function public.get_authorized_verification_codes(text, uuid) from public;
grant execute on function public.get_authorized_verification_codes(text, uuid) to authenticated, service_role;

-- Table-level SELECT overrides a column REVOKE. Grant every non-secret column.
-- Realtime column lists cannot include generated columns (orders.grand_total,
-- orders.total_cents). A failure here aborts the migration instead of dropping
-- the table from the publication.
create or replace function public.mmd_sync_trip_column_privileges(p_table text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secrets text[];
  v_grant text;
  v_pub text;
  v_published boolean;
begin
  if p_table in ('orders', 'delivery_requests') then
    v_secrets := array['pickup_code', 'dropoff_code'];
  elsif p_table = 'taxi_rides' then
    v_secrets := array['pickup_verification_code'];
  else
    return;
  end if;

  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
  into v_grant
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = p_table
    and a.attnum > 0
    and not a.attisdropped
    and not (a.attname = any (v_secrets));

  select string_agg(quote_ident(a.attname), ', ' order by a.attnum)
  into v_pub
  from pg_attribute a
  join pg_class c on c.oid = a.attrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = p_table
    and a.attnum > 0
    and not a.attisdropped
    and a.attgenerated = ''
    and not (a.attname = any (v_secrets));

  if v_grant is null or v_pub is null then
    raise exception 'trip column privilege sync found no columns for %', p_table;
  end if;

  execute format('revoke select on table public.%I from anon, authenticated', p_table);
  execute format('grant select (%s) on table public.%I to authenticated', v_grant, p_table);

  select exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = p_table
  )
  into v_published;

  if v_published then
    -- A column list cannot omit columns while replica identity is FULL.
    -- orders is FULL today; default identity keeps the primary key in the
    -- change stream and lets the secret columns stay out of it.
    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = p_table
        and c.relreplident = 'f'
    ) then
      execute format('alter table public.%I replica identity default', p_table);
    end if;

    execute format('alter publication supabase_realtime drop table public.%I', p_table);
    execute format(
      'alter publication supabase_realtime add table public.%I (%s)',
      p_table,
      v_pub
    );
  end if;
end;
$$;

revoke all on function public.mmd_sync_trip_column_privileges(text) from public, anon, authenticated;
grant execute on function public.mmd_sync_trip_column_privileges(text) to service_role;

select public.mmd_sync_trip_column_privileges('orders');
select public.mmd_sync_trip_column_privileges('delivery_requests');
select public.mmd_sync_trip_column_privileges('taxi_rides');

create or replace function public.mmd_sync_trip_columns_on_ddl()
returns event_trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in select * from pg_event_trigger_ddl_commands()
  loop
    if r.schema_name = 'public'
       and r.object_type = 'table'
       and r.object_identity in (
         'public.orders',
         'public.delivery_requests',
         'public.taxi_rides'
       )
    then
      perform public.mmd_sync_trip_column_privileges(
        split_part(r.object_identity, '.', 2)
      );
    end if;
  end loop;
end;
$$;

drop event trigger if exists mmd_sync_trip_columns;
create event trigger mmd_sync_trip_columns
  on ddl_command_end
  when tag in ('ALTER TABLE', 'CREATE TABLE')
  execute function public.mmd_sync_trip_columns_on_ddl();

create or replace function public.protect_order_verification_codes()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.pickup_code := null;
    new.dropoff_code := null;
    return new;
  end if;
  new.pickup_code := old.pickup_code;
  new.dropoff_code := old.dropoff_code;
  return new;
end;
$$;

create or replace function public.protect_delivery_request_verification_codes()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.pickup_code := null;
    new.dropoff_code := null;
    return new;
  end if;
  new.pickup_code := old.pickup_code;
  new.dropoff_code := old.dropoff_code;
  return new;
end;
$$;

create or replace function public.protect_taxi_verification_code()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.pickup_verification_code := null;
    return new;
  end if;
  new.pickup_verification_code := old.pickup_verification_code;
  return new;
end;
$$;

drop trigger if exists trg_protect_order_verification_codes on public.orders;
create trigger trg_protect_order_verification_codes
before insert or update on public.orders
for each row
execute function public.protect_order_verification_codes();

drop trigger if exists trg_protect_delivery_request_verification_codes on public.delivery_requests;
create trigger trg_protect_delivery_request_verification_codes
before insert or update on public.delivery_requests
for each row
execute function public.protect_delivery_request_verification_codes();

drop trigger if exists trg_protect_taxi_verification_code on public.taxi_rides;
create trigger trg_protect_taxi_verification_code
before insert or update on public.taxi_rides
for each row
execute function public.protect_taxi_verification_code();

revoke all on function public.protect_order_verification_codes() from public;
revoke all on function public.protect_delivery_request_verification_codes() from public;
revoke all on function public.protect_taxi_verification_code() from public;

-- ---------------------------------------------------------------------------
-- 6) Stats, capacity, analytics catalog
-- ---------------------------------------------------------------------------

create or replace function public.get_driver_stats(p_driver_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivered integer;
  v_canceled integer;
  v_total integer;
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    return jsonb_build_object('error', 'not_authenticated');
  end if;

  if v_caller is distinct from p_driver_id and not public.is_staff_user(v_caller) then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select
    count(*) filter (where lower(coalesce(status, '')) = 'delivered'),
    count(*) filter (where lower(coalesce(status, '')) in ('canceled', 'cancelled')),
    count(*)
  into v_delivered, v_canceled, v_total
  from public.orders
  where driver_id = p_driver_id
    and public.is_user_visible_trip_row(archived_at, is_test, hidden_from_user);

  return jsonb_build_object(
    'delivered', coalesce(v_delivered, 0),
    'canceled', coalesce(v_canceled, 0),
    'total', coalesce(v_total, 0)
  );
end;
$$;

revoke all on function public.get_driver_stats(uuid) from public;
grant execute on function public.get_driver_stats(uuid) to authenticated, service_role;

drop policy if exists driver_capacity_settings_auth_read on public.driver_capacity_settings;
create policy driver_capacity_settings_auth_read
  on public.driver_capacity_settings
  for select
  to authenticated
  using (
    public.is_staff_user(auth.uid())
    or exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and lower(trim(coalesce(p.role::text, ''))) = 'driver'
    )
  );

drop policy if exists analytics_card_catalog_select on public.analytics_card_catalog;
create policy analytics_card_catalog_select
  on public.analytics_card_catalog
  for select
  to authenticated
  using (public.is_staff_user(auth.uid()));

-- ---------------------------------------------------------------------------
-- 7) Marketplace test/archive flags used by minimum pay
-- ---------------------------------------------------------------------------

alter table public.marketplace_delivery_jobs
  add column if not exists archived_at timestamptz,
  add column if not exists is_test boolean not null default false,
  add column if not exists hidden_from_user boolean not null default false;

alter table public.seller_orders
  add column if not exists archived_at timestamptz,
  add column if not exists is_test boolean not null default false,
  add column if not exists hidden_from_user boolean not null default false;

-- The settings RPC is security definer and previously returned the row to every
-- authenticated user, which bypassed the table policy.
create or replace function public.get_driver_capacity_settings()
returns public.driver_capacity_settings
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.driver_capacity_settings;
begin
  if auth.uid() is not null
     and not public.is_staff_user(auth.uid())
     and not exists (
       select 1
       from public.profiles p
       where p.id = auth.uid()
         and lower(trim(coalesce(p.role::text, ''))) = 'driver'
     )
     and coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
  then
    raise exception 'forbidden';
  end if;

  if auth.uid() is null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'not_authenticated';
  end if;

  select *
  into v_row
  from public.driver_capacity_settings
  where singleton = true;

  return v_row;
end;
$$;

revoke all on function public.get_driver_capacity_settings() from public;
grant execute on function public.get_driver_capacity_settings() to authenticated, service_role;

-- get_driver_stats(from_ts, to_ts) already exists in production and returns
-- online_seconds/driving_seconds for auth.uid(). Do not replace its return type.

-- Remove memberships created by the old join_order hole.
-- Keep owners, the assigned driver, the restaurant user, and staff.
delete from public.order_members om
using public.orders o
where om.order_id = o.id
  and not public.is_staff_user(om.user_id)
  and om.user_id is distinct from o.client_user_id
  and om.user_id is distinct from o.client_id
  and om.user_id is distinct from o.user_id
  and om.user_id is distinct from o.created_by
  and om.user_id is distinct from o.driver_id
  and om.user_id is distinct from o.restaurant_user_id
  and om.user_id is distinct from o.restaurant_id;

commit;
