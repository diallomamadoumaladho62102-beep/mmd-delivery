-- Idempotency for outbound payout_transactions business keys.
-- Prevents duplicate rows on Stripe transfer / ledger bridge retries.

create unique index if not exists payout_transactions_order_payout_uidx
  on public.payout_transactions (order_payout_id)
  where order_payout_id is not null;

create unique index if not exists payout_transactions_external_reference_uidx
  on public.payout_transactions (external_reference)
  where external_reference is not null
    and btrim(external_reference) <> '';
