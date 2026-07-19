-- RLS for order_commissions: scoped reads; payouts stay on service_role.
-- Schema-aware: empty-DB orders bootstrap may lack restaurant_* / driver columns.

begin;

alter table public.order_commissions enable row level security;

drop policy if exists order_commissions_select_admin on public.order_commissions;
create policy order_commissions_select_admin
  on public.order_commissions
  for select
  to authenticated
  using (public.is_admin_user(auth.uid()));

drop policy if exists order_commissions_select_restaurant on public.order_commissions;
do $pol$
declare
  v_preds text[] := array[]::text[];
  v_sql text;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'restaurant_user_id'
  ) then
    v_preds := v_preds || array['o.restaurant_user_id = auth.uid()'];
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'restaurant_id'
  ) then
    v_preds := v_preds || array['o.restaurant_id = auth.uid()'];
  end if;

  if array_length(v_preds, 1) is null then
    -- No restaurant ownership columns yet: deny restaurant-scoped reads.
    execute $q$
      create policy order_commissions_select_restaurant
        on public.order_commissions
        for select
        to authenticated
        using (false)
    $q$;
  else
    v_sql := format(
      $q$
        create policy order_commissions_select_restaurant
          on public.order_commissions
          for select
          to authenticated
          using (
            exists (
              select 1
              from public.orders o
              where o.id = order_commissions.order_id
                and (%s)
            )
          )
      $q$,
      array_to_string(v_preds, ' or ')
    );
    execute v_sql;
  end if;
end;
$pol$;

drop policy if exists order_commissions_select_driver on public.order_commissions;
do $pol$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'driver_id'
  ) then
    execute $q$
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
        )
    $q$;
  else
    execute $q$
      create policy order_commissions_select_driver
        on public.order_commissions
        for select
        to authenticated
        using (false)
    $q$;
  end if;
end;
$pol$;

commit;
