-- Marketplace checkout architecture — draft orders + shadow pricing (no live Stripe)

begin;

-- ---------------------------------------------------------------------------
-- 1) seller_orders checkout fields + pending_checkout status
-- ---------------------------------------------------------------------------

alter table public.seller_orders
  drop constraint if exists seller_orders_status_check;

alter table public.seller_orders
  add constraint seller_orders_status_check
  check (status in ('draft', 'pending_checkout', 'pending', 'confirmed', 'canceled', 'fulfilled'));

alter table public.seller_orders
  add column if not exists subtotal_cents integer not null default 0
    check (subtotal_cents >= 0),
  add column if not exists delivery_fee_cents integer not null default 0
    check (delivery_fee_cents >= 0),
  add column if not exists service_fee_cents integer not null default 0
    check (service_fee_cents >= 0),
  add column if not exists checkout_shadow jsonb not null default '{}'::jsonb;

create index if not exists seller_orders_client_draft_idx
  on public.seller_orders (client_user_id, seller_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- 2) Marketplace browse policies (approved sellers + active products)
-- ---------------------------------------------------------------------------

drop policy if exists sellers_select_marketplace on public.sellers;
create policy sellers_select_marketplace
on public.sellers for select to authenticated
using (status = 'approved');

drop policy if exists seller_products_select_marketplace on public.seller_products;
create policy seller_products_select_marketplace
on public.seller_products for select to authenticated
using (
  active = true
  and exists (
    select 1
    from public.sellers s
    where s.id = seller_products.seller_id
      and s.status = 'approved'
  )
);

-- ---------------------------------------------------------------------------
-- 3) Client draft order policies
-- ---------------------------------------------------------------------------

drop policy if exists seller_orders_select on public.seller_orders;
drop policy if exists seller_order_items_select on public.seller_order_items;

drop policy if exists seller_orders_select_client on public.seller_orders;
create policy seller_orders_select_client
on public.seller_orders for select to authenticated
using (
  client_user_id = auth.uid()
  or public.user_owns_seller(seller_id, auth.uid())
  or public.is_staff_user(auth.uid())
);

drop policy if exists seller_orders_insert_client on public.seller_orders;
create policy seller_orders_insert_client
on public.seller_orders for insert to authenticated
with check (
  client_user_id = auth.uid()
  and status in ('draft', 'pending_checkout')
);

drop policy if exists seller_orders_update_client on public.seller_orders;
create policy seller_orders_update_client
on public.seller_orders for update to authenticated
using (
  client_user_id = auth.uid()
  and status in ('draft', 'pending_checkout')
)
with check (client_user_id = auth.uid());

drop policy if exists seller_order_items_select_client on public.seller_order_items;
create policy seller_order_items_select_client
on public.seller_order_items for select to authenticated
using (
  exists (
    select 1
    from public.seller_orders o
    where o.id = seller_order_items.order_id
      and (
        o.client_user_id = auth.uid()
        or public.user_owns_seller(o.seller_id, auth.uid())
        or public.is_staff_user(auth.uid())
      )
  )
);

drop policy if exists seller_order_items_write_client on public.seller_order_items;
create policy seller_order_items_write_client
on public.seller_order_items for all to authenticated
using (
  exists (
    select 1
    from public.seller_orders o
    where o.id = seller_order_items.order_id
      and o.client_user_id = auth.uid()
      and o.status = 'draft'
  )
)
with check (
  exists (
    select 1
    from public.seller_orders o
    where o.id = seller_order_items.order_id
      and o.client_user_id = auth.uid()
      and o.status = 'draft'
  )
);

commit;
