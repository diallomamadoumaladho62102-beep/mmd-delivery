-- ===========================================================================
-- Order soft-archive + driver mission capacity (Food/DR max 3) + taxi next-ride
-- ===========================================================================
-- Soft-archive columns hide test/demo rows from normal client/driver/admin lists.
-- Capacity is enforced in SQL accept RPCs (transactional) and mirrored in TS dispatch.
-- Taxi: 1 active + optional 1 queued next ride near destination.
-- ===========================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1) Soft-archive columns on trip tables
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists archived_at timestamptz,
  add column if not exists is_test boolean not null default false,
  add column if not exists hidden_from_user boolean not null default false;

alter table public.delivery_requests
  add column if not exists archived_at timestamptz,
  add column if not exists is_test boolean not null default false,
  add column if not exists hidden_from_user boolean not null default false;

alter table public.taxi_rides
  add column if not exists archived_at timestamptz,
  add column if not exists is_test boolean not null default false,
  add column if not exists hidden_from_user boolean not null default false,
  add column if not exists queued_after_ride_id uuid references public.taxi_rides(id),
  add column if not exists next_ride_eta_minutes integer,
  add column if not exists next_ride_notified_at timestamptz;

create index if not exists orders_hidden_from_user_idx
  on public.orders (client_user_id, created_at desc)
  where coalesce(hidden_from_user, false) = false and archived_at is null;

create index if not exists delivery_requests_hidden_from_user_idx
  on public.delivery_requests (client_user_id, created_at desc)
  where coalesce(hidden_from_user, false) = false and archived_at is null;

create index if not exists taxi_rides_hidden_from_user_idx
  on public.taxi_rides (client_user_id, created_at desc)
  where coalesce(hidden_from_user, false) = false and archived_at is null;

create index if not exists taxi_rides_queued_after_idx
  on public.taxi_rides (queued_after_ride_id)
  where queued_after_ride_id is not null;

create index if not exists taxi_rides_driver_active_idx
  on public.taxi_rides (driver_id, status)
  where driver_id is not null;

-- Extend taxi status to allow queued next-ride
alter table public.taxi_rides drop constraint if exists taxi_rides_status_check;
alter table public.taxi_rides
  add constraint taxi_rides_status_check check (
    status in (
      'draft',
      'quoted',
      'pending_payment',
      'scheduled',
      'paid',
      'dispatching',
      'accepted',
      'driver_arrived',
      'in_progress',
      'queued',
      'completed',
      'canceled'
    )
  );

-- ---------------------------------------------------------------------------
-- 2) Admin-configurable dispatch capacity settings (singleton)
-- ---------------------------------------------------------------------------
create table if not exists public.driver_capacity_settings (
  singleton boolean primary key default true check (singleton),
  -- Delivery / Food / Package
  max_active_delivery_missions integer not null default 3
    check (max_active_delivery_missions between 1 and 10),
  max_route_detour_miles numeric(8, 2) not null default 5
    check (max_route_detour_miles >= 0),
  max_route_detour_minutes integer not null default 15
    check (max_route_detour_minutes >= 0),
  max_added_eta_minutes integer not null default 20
    check (max_added_eta_minutes >= 0),
  route_compatibility_enabled boolean not null default true,
  food_hot_priority_enabled boolean not null default true,
  -- Taxi
  max_active_taxi_rides integer not null default 1
    check (max_active_taxi_rides between 1 and 3),
  max_queued_taxi_rides integer not null default 1
    check (max_queued_taxi_rides between 0 and 2),
  next_ride_eta_threshold_minutes integer not null default 5
    check (next_ride_eta_threshold_minutes between 1 and 30),
  next_ride_min_eta_minutes integer not null default 1
    check (next_ride_min_eta_minutes >= 0),
  next_ride_distance_threshold_miles numeric(8, 2) not null default 2
    check (next_ride_distance_threshold_miles > 0),
  next_ride_min_distance_miles numeric(8, 2) not null default 1
    check (next_ride_min_distance_miles >= 0),
  taxi_next_ride_enabled boolean not null default true,
  next_ride_delay_reassign_minutes integer not null default 10
    check (next_ride_delay_reassign_minutes >= 1),
  updated_at timestamptz not null default now()
);

insert into public.driver_capacity_settings (singleton)
values (true)
on conflict (singleton) do nothing;

drop trigger if exists trg_driver_capacity_settings_updated_at on public.driver_capacity_settings;
create trigger trg_driver_capacity_settings_updated_at
before update on public.driver_capacity_settings
for each row execute function public.taxi_set_updated_at();

alter table public.driver_capacity_settings enable row level security;

drop policy if exists driver_capacity_settings_staff_all on public.driver_capacity_settings;
create policy driver_capacity_settings_staff_all
  on public.driver_capacity_settings
  for all
  using (public.is_staff_user())
  with check (public.is_staff_user());

drop policy if exists driver_capacity_settings_auth_read on public.driver_capacity_settings;
create policy driver_capacity_settings_auth_read
  on public.driver_capacity_settings
  for select
  to authenticated
  using (true);

grant select on public.driver_capacity_settings to authenticated, service_role;
grant update on public.driver_capacity_settings to service_role;

-- ---------------------------------------------------------------------------
-- 3) Visibility helper
-- ---------------------------------------------------------------------------
create or replace function public.is_user_visible_trip_row(
  p_archived_at timestamptz,
  p_is_test boolean,
  p_hidden_from_user boolean
)
returns boolean
language sql
immutable
as $$
  select coalesce(p_archived_at, null) is null
    and coalesce(p_is_test, false) = false
    and coalesce(p_hidden_from_user, false) = false;
$$;

-- ---------------------------------------------------------------------------
-- 4) Delivery mission count + capacity gate
-- ---------------------------------------------------------------------------
create or replace function public.driver_active_delivery_mission_count(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select (
    (
      select count(*)::integer
      from public.orders o
      where o.driver_id = p_user_id
        and public.is_user_visible_trip_row(o.archived_at, o.is_test, o.hidden_from_user)
        and (
          public.is_active_order_for_tracking(o.status)
          or lower(coalesce(o.status, '')) in ('accepted', 'prepared', 'pending', 'dispatched')
        )
        and lower(coalesce(o.status, '')) not in ('delivered', 'canceled', 'cancelled', 'refunded')
    )
    +
    (
      select count(*)::integer
      from public.delivery_requests dr
      where dr.driver_id = p_user_id
        and public.is_user_visible_trip_row(dr.archived_at, dr.is_test, dr.hidden_from_user)
        and (
          public.is_active_delivery_request_for_tracking(dr.status)
          or lower(coalesce(dr.status, '')) in ('accepted', 'pending', 'dispatched', 'picked_up', 'in_transit')
        )
        and lower(coalesce(dr.status, '')) not in ('delivered', 'canceled', 'cancelled', 'refunded')
    )
  );
$$;

create or replace function public.driver_delivery_mission_capacity_ok(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_max integer;
  v_count integer;
begin
  select max_active_delivery_missions into v_max
  from public.driver_capacity_settings
  where singleton = true;

  v_max := coalesce(v_max, 3);
  v_count := public.driver_active_delivery_mission_count(p_user_id);
  return v_count < v_max;
end;
$$;

create or replace function public.get_driver_capacity_settings()
returns public.driver_capacity_settings
language sql
stable
security definer
set search_path = public
as $$
  select *
  from public.driver_capacity_settings
  where singleton = true;
$$;

-- ---------------------------------------------------------------------------
-- 5) Taxi active / queued / next-ride eligibility
-- ---------------------------------------------------------------------------
create or replace function public.driver_active_taxi_ride_count(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.taxi_rides tr
  where tr.driver_id = p_user_id
    and public.is_user_visible_trip_row(tr.archived_at, tr.is_test, tr.hidden_from_user)
    and lower(coalesce(tr.status, '')) in (
      'accepted', 'driver_arrived', 'in_progress', 'dispatching'
    );
$$;

create or replace function public.driver_queued_taxi_ride_count(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.taxi_rides tr
  where tr.driver_id = p_user_id
    and public.is_user_visible_trip_row(tr.archived_at, tr.is_test, tr.hidden_from_user)
    and lower(coalesce(tr.status, '')) = 'queued';
$$;

create or replace function public.driver_has_active_taxi_ride(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.driver_active_taxi_ride_count(p_user_id) > 0;
$$;

create or replace function public.haversine_miles(
  p_lat1 double precision,
  p_lng1 double precision,
  p_lat2 double precision,
  p_lng2 double precision
)
returns double precision
language sql
immutable
as $$
  select case
    when p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null then null
    else (
      3958.8 * 2 * asin(least(1.0, sqrt(
        power(sin(radians(p_lat2 - p_lat1) / 2), 2) +
        cos(radians(p_lat1)) * cos(radians(p_lat2)) *
        power(sin(radians(p_lng2 - p_lng1) / 2), 2)
      )))
    )
  end;
$$;

create or replace function public.taxi_driver_next_ride_eligible(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_settings public.driver_capacity_settings%rowtype;
  v_ride public.taxi_rides%rowtype;
  v_loc record;
  v_remaining_miles double precision;
  v_remaining_minutes double precision;
  v_eta_ok boolean := false;
  v_dist_ok boolean := false;
begin
  select * into v_settings from public.driver_capacity_settings where singleton = true;
  if not found or coalesce(v_settings.taxi_next_ride_enabled, true) is not true then
    return jsonb_build_object('ok', false, 'reason', 'next_ride_disabled');
  end if;

  if public.driver_queued_taxi_ride_count(p_user_id) >= coalesce(v_settings.max_queued_taxi_rides, 1) then
    return jsonb_build_object('ok', false, 'reason', 'queued_slot_full');
  end if;

  if public.driver_active_taxi_ride_count(p_user_id) = 0 then
    return jsonb_build_object('ok', true, 'mode', 'idle', 'reason', 'no_active_ride');
  end if;

  if public.driver_active_taxi_ride_count(p_user_id) > coalesce(v_settings.max_active_taxi_rides, 1) then
    return jsonb_build_object('ok', false, 'reason', 'too_many_active');
  end if;

  select * into v_ride
  from public.taxi_rides tr
  where tr.driver_id = p_user_id
    and public.is_user_visible_trip_row(tr.archived_at, tr.is_test, tr.hidden_from_user)
    and lower(coalesce(tr.status, '')) in ('accepted', 'driver_arrived', 'in_progress')
  order by coalesce(tr.accepted_at, tr.updated_at, tr.created_at) desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_qualifying_active_ride');
  end if;

  -- Must be in progress (or arrived) with confirmed destination, no open wait
  if lower(coalesce(v_ride.status, '')) not in ('in_progress', 'driver_arrived') then
    return jsonb_build_object('ok', false, 'reason', 'ride_not_near_end', 'status', v_ride.status);
  end if;

  if v_ride.dropoff_lat is null or v_ride.dropoff_lng is null then
    return jsonb_build_object('ok', false, 'reason', 'dropoff_missing');
  end if;

  if coalesce(v_ride.stop_count, 0) > coalesce(v_ride.current_stop_order, 0) then
    return jsonb_build_object('ok', false, 'reason', 'intermediate_stops_remain');
  end if;

  select lat, lng into v_loc
  from public.driver_locations
  where driver_id = p_user_id;

  if v_loc.lat is null or v_loc.lng is null then
    return jsonb_build_object('ok', false, 'reason', 'driver_location_missing');
  end if;

  v_remaining_miles := public.haversine_miles(
    v_loc.lat::double precision,
    v_loc.lng::double precision,
    v_ride.dropoff_lat::double precision,
    v_ride.dropoff_lng::double precision
  );

  -- Rough ETA from remaining miles (~2.5 min/mile urban default) capped by ride duration_minutes
  v_remaining_minutes := greatest(0, coalesce(v_remaining_miles, 99) * 2.5);
  if v_ride.duration_minutes is not null then
    v_remaining_minutes := least(v_remaining_minutes, greatest(0, v_ride.duration_minutes::double precision));
  end if;

  v_eta_ok :=
    v_remaining_minutes >= coalesce(v_settings.next_ride_min_eta_minutes, 1)
    and v_remaining_minutes <= coalesce(v_settings.next_ride_eta_threshold_minutes, 5);

  v_dist_ok :=
    v_remaining_miles is not null
    and v_remaining_miles >= coalesce(v_settings.next_ride_min_distance_miles, 1)
    and v_remaining_miles <= coalesce(v_settings.next_ride_distance_threshold_miles, 2);

  if not (v_eta_ok or v_dist_ok) then
    return jsonb_build_object(
      'ok', false,
      'reason', 'not_near_destination',
      'remaining_miles', v_remaining_miles,
      'remaining_minutes', v_remaining_minutes,
      'active_ride_id', v_ride.id
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'mode', 'next_ride',
    'active_ride_id', v_ride.id,
    'dropoff_lat', v_ride.dropoff_lat,
    'dropoff_lng', v_ride.dropoff_lng,
    'remaining_miles', v_remaining_miles,
    'remaining_minutes', round(v_remaining_minutes::numeric, 1)
  );
end;
$$;

create or replace function public.taxi_driver_can_receive_offer(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_eligibility jsonb;
begin
  if public.driver_active_taxi_ride_count(p_user_id) = 0
     and public.driver_queued_taxi_ride_count(p_user_id) = 0 then
    return true;
  end if;

  v_eligibility := public.taxi_driver_next_ride_eligible(p_user_id);
  return coalesce((v_eligibility->>'ok')::boolean, false) is true
    and coalesce(v_eligibility->>'mode', '') = 'next_ride';
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) Accept RPCs — delivery capacity lock
-- ---------------------------------------------------------------------------
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

  -- Transactional capacity lock: serialize accepts per driver via advisory lock
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

  return jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'active_missions', v_count + 1,
    'max_missions', v_max,
    'stack_label', format('Stacked delivery %s of %s', v_count + 1, v_max)
  );
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

-- ---------------------------------------------------------------------------
-- 7) Taxi validate + accept with next-ride queue
-- ---------------------------------------------------------------------------
create or replace function public.validate_taxi_offer_acceptance(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid := auth.uid();
  v_offer public.taxi_offers%rowtype;
  v_ride public.taxi_rides%rowtype;
  v_vehicle_id uuid;
  v_accept_standard boolean := false;
  v_fuel text;
  v_next jsonb;
  v_settings public.driver_capacity_settings%rowtype;
  v_pickup_miles double precision;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'reason_code', 'not_authenticated', 'reason_message', 'Authentification requise.');
  end if;

  select * into v_offer
  from public.taxi_offers
  where id = p_offer_id and driver_id = v_driver_id;

  if not found then
    return jsonb_build_object('ok', false, 'reason_code', 'offer_not_found', 'reason_message', 'Offre introuvable.');
  end if;

  select * into v_ride from public.taxi_rides where id = v_offer.taxi_ride_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason_code', 'ride_not_found', 'reason_message', 'Course introuvable.');
  end if;

  if v_offer.status <> 'pending' or v_offer.expires_at <= now() then
    return jsonb_build_object('ok', false, 'reason_code', 'offer_not_available', 'reason_message', 'Offre expirée ou indisponible.');
  end if;

  if not public.is_driver_identity_verified_for_taxi(v_driver_id) then
    return jsonb_build_object('ok', false, 'reason_code', 'identity_not_verified', 'reason_message', 'Vérification d''identité requise.');
  end if;

  if not public.is_taxi_account_active(v_driver_id) then
    return jsonb_build_object('ok', false, 'reason_code', 'account_inactive', 'reason_message', 'Compte inactif.');
  end if;

  if to_regprocedure('public.is_driver_operational(uuid)') is not null then
    if not public.is_driver_operational(v_driver_id) then
      return jsonb_build_object('ok', false, 'reason_code', 'driver_not_operational', 'reason_message', 'Compte chauffeur non approuvé.');
    end if;
  end if;

  if not exists (
    select 1 from public.driver_profiles dp
    where dp.user_id = v_driver_id and coalesce(dp.is_online, false) = true
  ) then
    return jsonb_build_object('ok', false, 'reason_code', 'driver_offline', 'reason_message', 'Vous devez être en ligne pour accepter.');
  end if;

  select * into v_settings from public.driver_capacity_settings where singleton = true;

  -- Active ride blocking with next-ride exception
  if public.driver_active_taxi_ride_count(v_driver_id) > 0
     and not exists (
       select 1 from public.taxi_rides tr
       where tr.id = v_ride.id and tr.driver_id = v_driver_id
     ) then
    v_next := public.taxi_driver_next_ride_eligible(v_driver_id);
    if coalesce((v_next->>'ok')::boolean, false) is not true
       or coalesce(v_next->>'mode', '') <> 'next_ride' then
      return jsonb_build_object(
        'ok', false,
        'reason_code', 'driver_unavailable',
        'reason_message', 'Vous avez déjà une course active.'
      );
    end if;

    -- Pickup of next ride must be near current dropoff (not original pickup)
    if v_ride.pickup_lat is not null and v_ride.pickup_lng is not null
       and (v_next->>'dropoff_lat') is not null and (v_next->>'dropoff_lng') is not null then
      v_pickup_miles := public.haversine_miles(
        (v_next->>'dropoff_lat')::double precision,
        (v_next->>'dropoff_lng')::double precision,
        v_ride.pickup_lat::double precision,
        v_ride.pickup_lng::double precision
      );
      if v_pickup_miles is not null
         and v_pickup_miles > coalesce(v_settings.next_ride_distance_threshold_miles, 2) * 2 then
        return jsonb_build_object(
          'ok', false,
          'reason_code', 'next_pickup_too_far',
          'reason_message', 'Le prochain pickup est trop loin de votre destination actuelle.'
        );
      end if;
    end if;
  end if;

  if public.driver_queued_taxi_ride_count(v_driver_id) >= coalesce(v_settings.max_queued_taxi_rides, 1)
     and not exists (
       select 1 from public.taxi_rides tr
       where tr.id = v_ride.id and tr.driver_id = v_driver_id
     ) then
    return jsonb_build_object(
      'ok', false,
      'reason_code', 'next_ride_already_queued',
      'reason_message', 'Vous avez déjà une prochaine course en file.'
    );
  end if;

  if not public.is_driver_service_enabled(v_driver_id, 'taxi') then
    return jsonb_build_object('ok', false, 'reason_code', 'taxi_service_disabled', 'reason_message', 'Service taxi désactivé.');
  end if;

  v_vehicle_id := public.get_driver_active_vehicle_id(v_driver_id);
  if v_vehicle_id is null then
    return jsonb_build_object('ok', false, 'reason_code', 'no_active_vehicle', 'reason_message', 'Aucun véhicule actif.');
  end if;

  if not public.driver_vehicle_documents_valid(v_vehicle_id) then
    return jsonb_build_object('ok', false, 'reason_code', 'vehicle_documents_invalid', 'reason_message', 'Documents véhicule invalides ou expirés.');
  end if;

  select coalesce(dsp.accept_also_standard_rides, false)
  into v_accept_standard
  from public.driver_service_preferences dsp
  where dsp.driver_user_id = v_driver_id;

  if not public.driver_matches_taxi_ride_category(v_vehicle_id, v_ride.vehicle_class, v_accept_standard) then
    return jsonb_build_object('ok', false, 'reason_code', 'category_not_eligible', 'reason_message', 'Catégorie véhicule incompatible avec la course.');
  end if;

  if not public.driver_satisfies_ride_preferences(v_driver_id, v_ride.id) then
    return jsonb_build_object('ok', false, 'reason_code', 'preferences_not_met', 'reason_message', 'Vous ne correspondez plus aux préférences client de cette course.');
  end if;

  if lower(coalesce(v_ride.payment_status, '')) <> 'paid' then
    return jsonb_build_object('ok', false, 'reason_code', 'ride_not_paid', 'reason_message', 'Course non payée.');
  end if;

  if v_ride.driver_id is not null and v_ride.driver_id <> v_driver_id then
    return jsonb_build_object('ok', false, 'reason_code', 'already_assigned', 'reason_message', 'Course déjà assignée.');
  end if;

  if lower(coalesce(v_ride.status, '')) not in ('paid', 'dispatching', 'queued') then
    return jsonb_build_object('ok', false, 'reason_code', 'ride_not_available', 'reason_message', 'Course non disponible.');
  end if;

  select dv.fuel_type into v_fuel from public.driver_vehicles dv where dv.id = v_vehicle_id;

  return jsonb_build_object(
    'ok', true,
    'vehicle_id', v_vehicle_id,
    'fuel_type', v_fuel,
    'is_green_vehicle', public.taxi_fuel_type_is_green(v_fuel),
    'client_preferences', coalesce(v_ride.client_preferences, '{}'::jsonb),
    'ambiance_preference', v_ride.ambiance_preference,
    'next_ride', coalesce(v_next, '{}'::jsonb)
  );
end;
$$;

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
  v_next jsonb;
  v_queue boolean := false;
  v_active_id uuid;
  v_eta integer;
begin
  if v_driver_id is null then
    return jsonb_build_object('ok', false, 'message', 'not_authenticated');
  end if;

  perform pg_advisory_xact_lock(hashtext('taxi_capacity:' || v_driver_id::text));

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
  v_next := coalesce(v_validation->'next_ride', '{}'::jsonb);
  v_queue := coalesce(v_next->>'mode', '') = 'next_ride'
    and public.driver_active_taxi_ride_count(v_driver_id) > 0;
  v_active_id := nullif(v_next->>'active_ride_id', '')::uuid;
  v_eta := ceil(coalesce((v_next->>'remaining_minutes')::numeric, 5));

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

  if v_queue then
    -- Double-check queued slot under lock
    if public.driver_queued_taxi_ride_count(v_driver_id) >= 1 then
      return jsonb_build_object('ok', false, 'message', 'next_ride_already_queued', 'should_redispatch', true);
    end if;

    update public.taxi_rides
    set
      driver_id = v_driver_id,
      status = 'queued',
      queued_after_ride_id = v_active_id,
      next_ride_eta_minutes = v_eta,
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
  else
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
  end if;

  update public.taxi_offers
  set status = 'accepted', vehicle_id = v_vehicle_id, fuel_type = v_fuel, updated_at = now()
  where id = p_offer_id;

  update public.taxi_offers
  set status = 'superseded', updated_at = now()
  where taxi_ride_id = v_offer.taxi_ride_id
    and id <> p_offer_id
    and status = 'pending';

  if not v_queue then
    v_sync := public.sync_taxi_shared_ride_driver(v_ride.id, v_driver_id);
  else
    v_sync := jsonb_build_object('queued', true);
  end if;

  v_old_status := coalesce(v_ride.status, 'dispatching');

  perform public.log_taxi_event(
    v_ride.id,
    case when v_queue then 'driver_queued_next_ride' else 'driver_accepted' end,
    v_old_status,
    case when v_queue then 'queued' else 'accepted' end,
    v_driver_id,
    'driver',
    case when v_queue then 'Driver queued next taxi ride' else 'Driver accepted taxi offer' end,
    jsonb_build_object(
      'offer_id', p_offer_id,
      'vehicle_id', v_vehicle_id,
      'fuel_type', v_fuel,
      'vehicle_plate', v_vehicle.license_plate,
      'shared_sync', v_sync,
      'queued_after_ride_id', v_active_id,
      'next_ride_eta_minutes', v_eta
    )
  );

  return jsonb_build_object(
    'ok', true,
    'taxi_ride_id', v_ride.id,
    'vehicle_id', v_vehicle_id,
    'is_green_vehicle', v_is_green,
    'vehicle_plate', v_vehicle.license_plate,
    'queued', v_queue,
    'queued_after_ride_id', v_active_id,
    'next_ride_eta_minutes', v_eta
  );
end;
$$;

-- Promote queued next ride when current ride completes/cancels
create or replace function public.promote_queued_taxi_ride_after_current()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next public.taxi_rides%rowtype;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if lower(coalesce(old.status, '')) not in ('in_progress', 'accepted', 'driver_arrived', 'dispatching') then
    return new;
  end if;

  if lower(coalesce(new.status, '')) not in ('completed', 'canceled') then
    return new;
  end if;

  if new.driver_id is null then
    return new;
  end if;

  select * into v_next
  from public.taxi_rides
  where driver_id = new.driver_id
    and lower(coalesce(status, '')) = 'queued'
    and queued_after_ride_id = new.id
  order by created_at asc
  limit 1
  for update skip locked;

  if not found then
    return new;
  end if;

  -- Do not auto-start blindly on cancel/incident — only promote to accepted for verification
  update public.taxi_rides
  set
    status = 'accepted',
    accepted_at = coalesce(accepted_at, now()),
    queued_after_ride_id = null,
    updated_at = now()
  where id = v_next.id
    and lower(status) = 'queued';

  perform public.log_taxi_event(
    v_next.id,
    'next_ride_promoted',
    'queued',
    'accepted',
    new.driver_id,
    'system',
    'Queued next ride promoted after current ride ended',
    jsonb_build_object('previous_ride_id', new.id, 'previous_status', new.status)
  );

  return new;
end;
$$;

drop trigger if exists trg_promote_queued_taxi_ride on public.taxi_rides;
create trigger trg_promote_queued_taxi_ride
after update of status on public.taxi_rides
for each row
execute function public.promote_queued_taxi_ride_after_current();

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public.driver_active_delivery_mission_count(uuid) from public;
revoke all on function public.driver_delivery_mission_capacity_ok(uuid) from public;
revoke all on function public.taxi_driver_next_ride_eligible(uuid) from public;
revoke all on function public.taxi_driver_can_receive_offer(uuid) from public;
revoke all on function public.get_driver_capacity_settings() from public;

grant execute on function public.driver_active_delivery_mission_count(uuid) to authenticated, service_role;
grant execute on function public.driver_delivery_mission_capacity_ok(uuid) to authenticated, service_role;
grant execute on function public.taxi_driver_next_ride_eligible(uuid) to authenticated, service_role;
grant execute on function public.taxi_driver_can_receive_offer(uuid) to authenticated, service_role;
grant execute on function public.get_driver_capacity_settings() to authenticated, service_role;
grant execute on function public.driver_active_taxi_ride_count(uuid) to authenticated, service_role;
grant execute on function public.driver_queued_taxi_ride_count(uuid) to authenticated, service_role;

revoke all on function public.driver_accept_order_offer(uuid) from public;
revoke all on function public.driver_accept_delivery_request_offer(uuid) from public;
revoke all on function public.driver_accept_taxi_offer(uuid) from public;
revoke all on function public.validate_taxi_offer_acceptance(uuid) from public;

grant execute on function public.driver_accept_order_offer(uuid) to authenticated;
grant execute on function public.driver_accept_delivery_request_offer(uuid) to authenticated;
grant execute on function public.driver_accept_taxi_offer(uuid) to authenticated, service_role;
grant execute on function public.validate_taxi_offer_acceptance(uuid) to authenticated, service_role;

commit;
