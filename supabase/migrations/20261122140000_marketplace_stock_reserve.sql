-- Marketplace stock reservation at checkout (prevents oversell under concurrent checkouts).

alter table if exists public.seller_orders
  add column if not exists stock_reserved_at timestamptz;

comment on column public.seller_orders.stock_reserved_at is
  'When set, marketplace stock was atomically reserved for this order at live checkout.';

create or replace function public.mmd_reserve_marketplace_stock(p_seller_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  reserved_at timestamptz;
begin
  select stock_reserved_at into reserved_at
  from public.seller_orders
  where id = p_seller_order_id
  for update;

  if not found then
    raise exception 'seller_order_not_found';
  end if;

  if reserved_at is not null then
    return;
  end if;

  for r in
    select oi.product_id, oi.quantity
    from public.seller_order_items oi
    join public.seller_products sp on sp.id = oi.product_id
    where oi.order_id = p_seller_order_id
      and oi.product_id is not null
      and sp.stock_qty is not null
    order by oi.product_id
    for update of sp
  loop
    update public.seller_products
    set stock_qty = stock_qty - r.quantity,
        updated_at = now()
    where id = r.product_id
      and stock_qty >= r.quantity;

    if not found then
      raise exception 'insufficient_stock for product %', r.product_id;
    end if;
  end loop;

  update public.seller_orders
  set stock_reserved_at = now(),
      updated_at = now()
  where id = p_seller_order_id;
end;
$$;

create or replace function public.mmd_release_marketplace_stock(p_seller_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  reserved_at timestamptz;
  payment_status text;
begin
  select stock_reserved_at, payment_status
  into reserved_at, payment_status
  from public.seller_orders
  where id = p_seller_order_id
  for update;

  if not found or reserved_at is null then
    return;
  end if;

  if payment_status = 'paid' then
    return;
  end if;

  for r in
    select oi.product_id, oi.quantity
    from public.seller_order_items oi
    join public.seller_products sp on sp.id = oi.product_id
    where oi.order_id = p_seller_order_id
      and oi.product_id is not null
      and sp.stock_qty is not null
  loop
    update public.seller_products
    set stock_qty = stock_qty + r.quantity,
        updated_at = now()
    where id = r.product_id;
  end loop;

  update public.seller_orders
  set stock_reserved_at = null,
      updated_at = now()
  where id = p_seller_order_id;
end;
$$;

create or replace function public.mmd_decrement_marketplace_stock(p_seller_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  reserved_at timestamptz;
begin
  select stock_reserved_at into reserved_at
  from public.seller_orders
  where id = p_seller_order_id;

  if reserved_at is not null then
    return;
  end if;

  for r in
    select oi.product_id, oi.quantity
    from public.seller_order_items oi
    join public.seller_products sp on sp.id = oi.product_id
    where oi.order_id = p_seller_order_id
      and oi.product_id is not null
      and sp.stock_qty is not null
  loop
    update public.seller_products
    set stock_qty = stock_qty - r.quantity,
        updated_at = now()
    where id = r.product_id
      and stock_qty >= r.quantity;

    if not found then
      raise exception 'insufficient_stock for product %', r.product_id;
    end if;
  end loop;
end;
$$;

revoke all on function public.mmd_reserve_marketplace_stock(uuid) from public;
revoke all on function public.mmd_release_marketplace_stock(uuid) from public;
revoke all on function public.mmd_decrement_marketplace_stock(uuid) from public;

grant execute on function public.mmd_reserve_marketplace_stock(uuid) to service_role;
grant execute on function public.mmd_release_marketplace_stock(uuid) to service_role;
grant execute on function public.mmd_decrement_marketplace_stock(uuid) to service_role;
