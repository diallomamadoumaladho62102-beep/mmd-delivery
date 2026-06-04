-- RLS for order_commissions: scoped reads; payouts stay on service_role.

begin;

alter table public.order_commissions enable row level security;

drop policy if exists order_commissions_select_admin on public.order_commissions;
create policy order_commissions_select_admin
  on public.order_commissions
  for select
  to authenticated
  using (public.is_admin_user(auth.uid()));

drop policy if exists order_commissions_select_restaurant on public.order_commissions;
create policy order_commissions_select_restaurant
  on public.order_commissions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_commissions.order_id
        and (
          o.restaurant_user_id = auth.uid()
          or o.restaurant_id = auth.uid()
        )
    )
  );

drop policy if exists order_commissions_select_driver on public.order_commissions;
create policy order_commissions_select_driver
  on public.order_commissions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_commissions.order_id
        and o.driver_id = auth.uid()
    )
  );

commit;
