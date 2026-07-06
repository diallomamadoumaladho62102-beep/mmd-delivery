-- Idempotent Stripe inbound payments in wallet ledger bridge.

begin;

create unique index if not exists payment_transactions_stripe_external_ref_uidx
  on public.payment_transactions (provider, external_reference)
  where external_reference is not null
    and provider = 'stripe';

commit;
