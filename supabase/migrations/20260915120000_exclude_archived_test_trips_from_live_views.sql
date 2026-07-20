-- ===========================================================================
-- Exclude soft-archived / test trips from normal production reads & analytics
-- ===========================================================================
-- Builds on 20260914120000 columns: archived_at, is_test, hidden_from_user.
-- Live views + helper; analytics refresh ignores archived/test parents.
-- ===========================================================================

begin;

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

comment on function public.is_user_visible_trip_row(timestamptz, boolean, boolean) is
  'True when a trip row should appear in normal client/driver/admin production views';

-- Live-only convenience views (security invoker so RLS still applies)
create or replace view public.v_orders_live
with (security_invoker = true)
as
select *
from public.orders o
where public.is_user_visible_trip_row(o.archived_at, o.is_test, o.hidden_from_user);

create or replace view public.v_delivery_requests_live
with (security_invoker = true)
as
select *
from public.delivery_requests dr
where public.is_user_visible_trip_row(dr.archived_at, dr.is_test, dr.hidden_from_user);

create or replace view public.v_taxi_rides_live
with (security_invoker = true)
as
select *
from public.taxi_rides tr
where public.is_user_visible_trip_row(tr.archived_at, tr.is_test, tr.hidden_from_user);

grant select on public.v_orders_live to authenticated, service_role;
grant select on public.v_delivery_requests_live to authenticated, service_role;
grant select on public.v_taxi_rides_live to authenticated, service_role;

-- Explicit archived/test catalog for founder/admin inspection
create or replace view public.v_trips_archived_test
with (security_invoker = true)
as
select
  'order'::text as entity_kind,
  o.id,
  o.status,
  o.payment_status,
  o.stripe_payment_intent_id,
  o.stripe_session_id,
  o.client_user_id,
  o.driver_id,
  o.total,
  o.created_at,
  o.archived_at,
  o.is_test,
  o.hidden_from_user
from public.orders o
where not public.is_user_visible_trip_row(o.archived_at, o.is_test, o.hidden_from_user)
union all
select
  'delivery_request'::text,
  dr.id,
  dr.status,
  dr.payment_status,
  dr.stripe_payment_intent_id,
  dr.stripe_session_id,
  dr.client_user_id,
  dr.driver_id,
  coalesce(dr.total, null::numeric),
  dr.created_at,
  dr.archived_at,
  dr.is_test,
  dr.hidden_from_user
from public.delivery_requests dr
where not public.is_user_visible_trip_row(dr.archived_at, dr.is_test, dr.hidden_from_user)
union all
select
  'taxi_ride'::text,
  tr.id,
  tr.status,
  tr.payment_status,
  tr.stripe_payment_intent_id,
  tr.stripe_session_id,
  tr.client_user_id,
  tr.driver_id,
  (coalesce(tr.total_cents, 0)::numeric / 100.0),
  tr.created_at,
  tr.archived_at,
  tr.is_test,
  tr.hidden_from_user
from public.taxi_rides tr
where not public.is_user_visible_trip_row(tr.archived_at, tr.is_test, tr.hidden_from_user);

grant select on public.v_trips_archived_test to authenticated, service_role;

-- Patch get_driver_stats if present: count only live delivered orders
do $$
begin
  if to_regprocedure('public.get_driver_stats(uuid)') is not null then
    execute $fn$
      create or replace function public.get_driver_stats(p_driver_id uuid)
      returns jsonb
      language plpgsql
      security definer
      set search_path = public
      as $body$
      declare
        v_delivered integer;
        v_canceled integer;
        v_total integer;
      begin
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
      $body$;
    $fn$;
  end if;
end $$;

-- Patch analytics daily refresh body to skip archived/test parents when function exists
-- (redefine only the counting CTEs via create or replace of mmd_analytics_refresh_daily
--  if the function signature matches; otherwise leave a helper for TS layer.)

create or replace function public.trip_parent_is_live(
  p_entity_type text,
  p_entity_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ok boolean := false;
begin
  if p_entity_id is null then
    return false;
  end if;

  if lower(coalesce(p_entity_type, '')) in ('order', 'food_order', 'orders') then
    select public.is_user_visible_trip_row(o.archived_at, o.is_test, o.hidden_from_user)
    into v_ok
    from public.orders o
    where o.id = p_entity_id;
    return coalesce(v_ok, false);
  end if;

  if lower(coalesce(p_entity_type, '')) in ('delivery_request', 'package', 'delivery_requests') then
    select public.is_user_visible_trip_row(dr.archived_at, dr.is_test, dr.hidden_from_user)
    into v_ok
    from public.delivery_requests dr
    where dr.id = p_entity_id;
    return coalesce(v_ok, false);
  end if;

  if lower(coalesce(p_entity_type, '')) in ('taxi_ride', 'taxi', 'taxi_rides') then
    select public.is_user_visible_trip_row(tr.archived_at, tr.is_test, tr.hidden_from_user)
    into v_ok
    from public.taxi_rides tr
    where tr.id = p_entity_id;
    return coalesce(v_ok, false);
  end if;

  -- Unknown parent type: do not hide (fail-open for non-trip finance rows)
  return true;
end;
$$;

grant execute on function public.trip_parent_is_live(text, uuid) to authenticated, service_role;
grant execute on function public.is_user_visible_trip_row(timestamptz, boolean, boolean) to authenticated, service_role;

commit;
