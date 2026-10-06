-- Unambiguous driver stats, taxi pickup-code rate limit, and a membership audit.
-- Realtime keeps replica identity DEFAULT so verification codes stay out of
-- the publication. Clients refetch on foreground and reconnect.

begin;

drop function if exists public.get_driver_stats(uuid, timestamptz, timestamptz);

create function public.get_driver_stats(
  p_driver_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_online bigint := 0;
  v_driving bigint := 0;
  v_trips integer := 0;
begin
  if v_caller is null and coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;

  if p_driver_id is null or p_from is null or p_to is null or p_from > p_to then
    return jsonb_build_object('ok', false, 'error', 'invalid_range');
  end if;

  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role'
     and v_caller is distinct from p_driver_id
     and not public.is_staff_user(v_caller)
  then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  select coalesce(sum(
    extract(epoch from (
      least(coalesce(ds.ended_at, p_to), p_to)
      - greatest(ds.started_at, p_from)
    ))
  ), 0)::bigint
  into v_online
  from public.driver_sessions ds
  where ds.driver_id = p_driver_id
    and ds.started_at < p_to
    and coalesce(ds.ended_at, p_to) > p_from;

  select coalesce(sum(
    extract(epoch from (
      least(coalesce(dds.ended_at, p_to), p_to)
      - greatest(dds.started_at, p_from)
    ))
  ), 0)::bigint
  into v_driving
  from public.driver_drive_sessions dds
  where dds.driver_id = p_driver_id
    and dds.started_at < p_to
    and coalesce(dds.ended_at, p_to) > p_from;

  select count(*)::integer
  into v_trips
  from public.orders o
  where o.driver_id = p_driver_id
    and o.status = 'delivered'
    and o.created_at >= p_from
    and o.created_at <= p_to
    and public.is_user_visible_trip_row(o.archived_at, o.is_test, o.hidden_from_user);

  return jsonb_build_object(
    'ok', true,
    'driver_id', p_driver_id,
    'online_seconds', v_online,
    'driving_seconds', v_driving,
    'trips', v_trips,
    'points', v_trips
  );
end;
$$;

revoke all on function public.get_driver_stats(uuid, timestamptz, timestamptz) from public;
grant execute on function public.get_driver_stats(uuid, timestamptz, timestamptz) to authenticated, service_role;

comment on function public.get_driver_stats(timestamptz, timestamptz) is
  'Driver Revenue contract. Uses auth.uid() and driver_sessions / driver_drive_sessions. No defaults, so it does not overlap get_driver_stats(uuid) or the staff lookup.';

comment on function public.get_driver_stats(uuid, timestamptz, timestamptz) is
  'Staff or self lookup. online_seconds and driving_seconds come from driver_sessions and driver_drive_sessions. Arguments have no defaults.';

create or replace function public.verification_attempt_blocked(
  p_user uuid,
  p_entity uuid,
  p_kind text,
  p_limit integer
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select count(*) >= greatest(coalesce(p_limit, 8), 1)
  from public.verification_code_attempts a
  where a.user_id = p_user
    and a.entity_id = p_entity
    and a.code_type = p_kind
    and a.created_at > now() - interval '15 minutes';
$$;

revoke all on function public.verification_attempt_blocked(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.verification_attempt_blocked(uuid, uuid, text, integer) to service_role;

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

  if public.verification_attempt_blocked(v_driver_id, p_ride_id, 'taxi_pickup', 5) then
    return jsonb_build_object('ok', false, 'message', 'rate_limited');
  end if;

  if v_ride.pickup_verification_code is null then
    update public.taxi_rides
    set pickup_verification_code = public.taxi_generate_pickup_verification_code()
    where id = p_ride_id
    returning * into v_ride;
  end if;

  if length(v_code) <> 4 or v_code <> v_ride.pickup_verification_code then
    perform public.verification_attempt_record(v_driver_id, p_ride_id, 'taxi_pickup');
    return jsonb_build_object('ok', false, 'message', 'invalid_pickup_code');
  end if;

  perform public.verification_attempt_clear(v_driver_id, p_ride_id, 'taxi_pickup');

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
grant execute on function public.driver_start_taxi_ride(uuid, text) to authenticated, service_role;

create or replace function public.count_unauthorized_order_members()
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.order_members om
  join public.orders o on o.id = om.order_id
  where not public.is_staff_user(om.user_id)
    and om.user_id is distinct from o.client_user_id
    and om.user_id is distinct from o.client_id
    and om.user_id is distinct from o.user_id
    and om.user_id is distinct from o.created_by
    and om.user_id is distinct from o.driver_id
    and om.user_id is distinct from o.restaurant_user_id
    and om.user_id is distinct from o.restaurant_id;
$$;

revoke all on function public.count_unauthorized_order_members() from public, anon, authenticated;
grant execute on function public.count_unauthorized_order_members() to service_role;

comment on function public.mmd_sync_trip_column_privileges(text) is
  'Grants non-secret columns and publishes the same list. Replica identity stays DEFAULT: FULL would put pickup and dropoff codes into supabase_realtime. Mobile refetches on foreground, reconnect, and network recovery.';

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'taxi_offers'
  ) then
    alter publication supabase_realtime add table public.taxi_offers;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'driver_order_offers'
  ) then
    alter publication supabase_realtime add table public.driver_order_offers;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'delivery_request_driver_offers'
  ) then
    alter publication supabase_realtime add table public.delivery_request_driver_offers;
  end if;
end $$;

commit;
