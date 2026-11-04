-- Marketplace local cash checkout (GN / SN / CI).
-- Allows seller_orders.payment_status = 'pending_cash' and 'cash_collected'
-- (set by POST /api/marketplace/orders/cash-collected once the seller confirms
-- the cash was received).
-- Does not change historical rows, Stripe flows, or US markets.
-- Not applied. Do not run this file with supabase db push.

begin;

alter table public.seller_orders
  drop constraint if exists seller_orders_payment_status_check;

alter table public.seller_orders
  add constraint seller_orders_payment_status_check
  check (
    payment_status in (
      'unpaid',
      'pending',
      'pending_cash',
      'cash_collected',
      'paid',
      'failed',
      'cancelled'
    )
  );

commit;
