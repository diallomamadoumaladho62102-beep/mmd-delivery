-- Driver tip funding (Wave 2c): tips are 100% for the driver Connect
-- destination and must be backed by their OWN Stripe PaymentIntent/charge —
-- see apps/web/src/lib/finance/tipMoneyArchitecture.ts for the full rule.
--
-- Adds the columns createDriverTipPaymentIntent / executeDriverTipTransfer
-- need to track the tip's own payment + SCT transfer, separately from the
-- food order's own stripe_payment_intent_id / driver_transfer_id.
--
-- Idempotent: add-column-if-not-exists only, no destructive changes.

begin;

do $$
begin
  if to_regclass('public.orders') is not null then
    alter table public.orders
      add column if not exists tip_payment_intent_id text;
    alter table public.orders
      add column if not exists tip_stripe_charge_id text;
    alter table public.orders
      add column if not exists tip_transfer_id text;
    alter table public.orders
      add column if not exists tip_paid_out boolean not null default false;
    alter table public.orders
      add column if not exists tip_transferred_at timestamptz;
  end if;
end $$;

-- One tip PaymentIntent settles at most one order's tip.
create unique index if not exists orders_tip_payment_intent_uq
  on public.orders (tip_payment_intent_id)
  where tip_payment_intent_id is not null;

create index if not exists orders_tip_transfer_pending_idx
  on public.orders (id)
  where tip_cents > 0 and tip_paid_out = false;

commit;
