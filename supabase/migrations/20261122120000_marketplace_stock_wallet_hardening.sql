-- Marketplace: atomic stock decrement on paid orders + wallet entry idempotence.

create or replace function public.mmd_decrement_marketplace_stock(p_seller_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
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

revoke all on function public.mmd_decrement_marketplace_stock(uuid) from public;
grant execute on function public.mmd_decrement_marketplace_stock(uuid) to service_role;

comment on function public.mmd_decrement_marketplace_stock(uuid) is
  'Atomically decrements seller_products.stock_qty for a paid marketplace order. Skips unlimited (null) stock.';

create unique index if not exists marketplace_seller_wallet_entries_order_type_uq
  on public.marketplace_seller_wallet_entries (seller_order_id, entry_type)
  where seller_order_id is not null;
