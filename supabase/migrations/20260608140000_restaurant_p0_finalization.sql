-- Restaurant P0: participant order visibility + menu public read + restaurant ownership guards.

begin;

-- ---------------------------------------------------------------------------
-- 1) Orders — restaurant/client/driver participants can read their orders
-- ---------------------------------------------------------------------------

do $orders_rls$
begin
  if to_regclass('public.orders') is null then
    return;
  end if;

  if to_regprocedure('public.order_participant_ids(uuid)') is null then
    raise notice 'order_participant_ids(uuid) missing — skip orders_select_participants';
    return;
  end if;

  alter table public.orders enable row level security;

  drop policy if exists orders_select_participants on public.orders;
  execute $pol$
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
      )
  $pol$;
end
$orders_rls$;

-- ---------------------------------------------------------------------------
-- 2) restaurant_items — public read of available items, owner full access
-- ---------------------------------------------------------------------------

do $items_rls$
begin
  if to_regclass('public.restaurant_items') is null then
    return;
  end if;

  alter table public.restaurant_items enable row level security;

  drop policy if exists restaurant_items_select_public_available on public.restaurant_items;
  execute $pol$
    create policy restaurant_items_select_public_available
      on public.restaurant_items
      for select
      to anon, authenticated
      using (coalesce(is_available, false) = true)
  $pol$;

  drop policy if exists restaurant_items_select_own on public.restaurant_items;
  execute $pol$
    create policy restaurant_items_select_own
      on public.restaurant_items
      for select
      to authenticated
      using (restaurant_user_id = auth.uid())
  $pol$;

  drop policy if exists restaurant_items_insert_own on public.restaurant_items;
  execute $pol$
    create policy restaurant_items_insert_own
      on public.restaurant_items
      for insert
      to authenticated
      with check (restaurant_user_id = auth.uid())
  $pol$;

  drop policy if exists restaurant_items_update_own on public.restaurant_items;
  execute $pol$
    create policy restaurant_items_update_own
      on public.restaurant_items
      for update
      to authenticated
      using (restaurant_user_id = auth.uid())
      with check (restaurant_user_id = auth.uid())
  $pol$;

  drop policy if exists restaurant_items_delete_own on public.restaurant_items;
  execute $pol$
    create policy restaurant_items_delete_own
      on public.restaurant_items
      for delete
      to authenticated
      using (restaurant_user_id = auth.uid())
  $pol$;

  drop policy if exists restaurant_items_select_staff on public.restaurant_items;
  execute $pol$
    create policy restaurant_items_select_staff
      on public.restaurant_items
      for select
      to authenticated
      using (public.is_staff_user(auth.uid()))
  $pol$;
end
$items_rls$;

commit;
