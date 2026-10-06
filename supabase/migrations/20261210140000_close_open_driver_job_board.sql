-- Offer visibility is the only way an unassigned driver may read a job.
-- Older policies still let every driver (and, for packages, every authenticated
-- user) read unassigned ready or pending jobs, so an expired or missing offer
-- did not remove access.

begin;

drop policy if exists drivers_can_see_available_orders on public.orders;
drop policy if exists drivers_can_see_ready_orders on public.orders;
drop policy if exists drivers_can_see_pending_pickup_dropoff on public.orders;
drop policy if exists delivery_requests_select_available_for_drivers on public.delivery_requests;

drop policy if exists orders_member_select on public.orders;
create policy orders_member_select
  on public.orders
  for select
  to authenticated
  using (
    coalesce(auth.role(), '') = 'service_role'
    or exists (
      select 1
      from public.order_members om
      where om.order_id = orders.id
        and om.user_id = auth.uid()
    )
  );

commit;
