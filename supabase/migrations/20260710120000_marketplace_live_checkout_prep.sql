-- Phase 11: Marketplace live checkout preparation (Stripe fields + statuses, OFF by default in app)

begin;

alter table public.seller_orders
  drop constraint if exists seller_orders_status_check;

alter table public.seller_orders
  add constraint seller_orders_status_check
  check (
    status in (
      'draft',
      'pending_checkout',
      'pending_payment',
      'paid',
      'payment_failed',
      'cancelled',
      'pending',
      'confirmed',
      'canceled',
      'fulfilled'
    )
  );

alter table public.seller_orders
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists paid_at timestamptz,
  add column if not exists payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid', 'pending', 'paid', 'failed', 'cancelled'));

create index if not exists seller_orders_payment_status_idx
  on public.seller_orders (payment_status, updated_at desc);

create index if not exists seller_orders_stripe_session_idx
  on public.seller_orders (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

commit;
