-- Least-privilege read access to driver_locations for active trip participants.

create or replace function public.is_active_order_for_tracking(p_status text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(p_status, '')) in (
    'preparing',
    'ready',
    'dispatched',
    'picked_up',
    'in_transit',
    'out_for_delivery'
  );
$$;

create or replace function public.is_active_delivery_request_for_tracking(p_status text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(p_status, '')) in (
    'dispatched',
    'picked_up',
    'in_transit'
  );
$$;

create or replace function public.is_active_taxi_ride_for_tracking(p_status text)
returns boolean
language sql
immutable
as $$
  select lower(coalesce(p_status, '')) in (
    'paid',
    'dispatching',
    'dispatched',
    'accepted',
    'in_progress',
    'arriving',
    'started'
  );
$$;

create or replace function public.can_read_driver_location(p_driver_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select
    auth.uid() is not null
    and (
      p_driver_id = auth.uid()
      or public.is_staff_user(auth.uid())
      or exists (
        select 1
        from public.orders o
        where o.driver_id = p_driver_id
          and public.is_active_order_for_tracking(o.status)
          and exists (
            select 1
            from public.order_participant_ids(o.id) p
            where p.user_id = auth.uid()
          )
      )
      or exists (
        select 1
        from public.delivery_requests dr
        where dr.driver_id = p_driver_id
          and public.is_active_delivery_request_for_tracking(dr.status)
          and exists (
            select 1
            from public.delivery_request_participant_ids(dr.id) p
            where p.user_id = auth.uid()
          )
      )
      or exists (
        select 1
        from public.taxi_rides tr
        where tr.driver_id = p_driver_id
          and public.is_active_taxi_ride_for_tracking(tr.status)
          and exists (
            select 1
            from public.taxi_ride_participant_ids(tr.id) p
            where p.user_id = auth.uid()
          )
      )
    );
$$;

revoke all on function public.can_read_driver_location(uuid) from public;
grant execute on function public.can_read_driver_location(uuid) to authenticated;

drop policy if exists driver_locations_select_participants on public.driver_locations;
create policy driver_locations_select_participants
  on public.driver_locations
  for select
  to authenticated
  using (public.can_read_driver_location(driver_id));
