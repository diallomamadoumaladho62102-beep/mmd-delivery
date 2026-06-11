-- P1: block direct client writes on marketplace draft orders (API service_role only)

begin;

drop policy if exists seller_orders_insert_client on public.seller_orders;
drop policy if exists seller_orders_update_client on public.seller_orders;
drop policy if exists seller_order_items_write_client on public.seller_order_items;

-- Reads remain via seller_orders_select_client / seller_order_items_select_client.
-- Draft writes go through /api/marketplace/cart/draft (service role).

commit;
