# Wallet ledger & Africa payments runbook

Ops guide for flipping payment methods out of `test_mode` and verifying inbound wallet ledger writes. Does **not** replace Stripe Live webhook or CRITICAL payment-path certification.

## Prerequisites

- Admin access to `/admin/payment-methods`
- Supabase SQL editor (or read-only BI) on production
- Provider secrets configured per `paymentProviderSecrets.ts`:
  - Orange Money GN: `ORANGE_MONEY_GN_MERCHANT_KEY`, `ORANGE_MONEY_GN_CLIENT_ID`, `ORANGE_MONEY_GN_CLIENT_SECRET`, `ORANGE_MONEY_GN_ACCESS_TOKEN`, `ORANGE_MONEY_GN_WEBHOOK_SECRET`
  - CinetPay: `CINETPAY_API_KEY`, `CINETPAY_SITE_ID`, `CINETPAY_WEBHOOK_SECRET`
  - PayDunya / Stripe as applicable
- Country enabled in `/admin/platform-launch` with `checkout_enabled` as needed

## Flip `test_mode` → live (Africa methods)

1. Confirm provider secrets are present in Vercel production (missing secrets keep methods unavailable even when enabled).
2. Open `/admin/payment-methods` for the target country (`GN`, `SN`, `CI`, etc.).
3. For each method to go live:
   - Ensure `enabled = true`
   - Set `test_mode = false` (uncheck Test)
   - Save and confirm the row shows secrets configured / runtime available
4. Smoke one small real payment per provider (not a replay of an old test txn).
5. Confirm mobile `PaymentMethodPicker` no longer shows the **Test** badge for that method.

Rollback: set `test_mode = true` (or `enabled = false`) immediately if provider callbacks fail or ledger rows are missing.

## Verify wallet ledger after a paid transaction

Inbound paid transactions should write ledger rows via `recordInboundPaymentWalletEntries` (`inboundWalletBridge`):

| Account | Direction | Meaning |
|---------|-----------|---------|
| `platform` | credit | Platform received inbound payment |
| `client` | debit | Client payment captured |

### SQL checks (adjust IDs)

```sql
-- 1) Find the payment transaction
select id, status, provider, country_code, currency, amount_cents, entity_type, entity_id, updated_at
from payment_transactions
where id = '<payment_transaction_id>';

-- 2) Ledger rows for that payment (reference_type + reference_id)
select *
from wallet_ledger
where reference_type = 'payment_transaction'
  and reference_id = '<payment_transaction_id>'
order by created_at;

-- Expect: one platform credit + one client debit, same amount_cents / currency / country_code
```

If the transaction is `paid` but ledger rows are missing:

1. Do **not** manually invent ledger rows in production without eng review.
2. Check app logs for `wallet_ledger_write_failed` / inbound bridge errors.
3. Escalate to eng — CRITICAL completion paths are owned separately; this runbook is verification only.

## Africa launch sequence (payments slice)

1. Secrets + webhooks live for the provider.
2. Platform launch flags for country.
3. Methods enabled with `test_mode=true` → device smoke with Test badge visible.
4. Flip `test_mode=false` → one live smoke → ledger SQL above.
5. Only then enable broader traffic / `payout_enabled` per `EXTERNAL_OPS_MANUAL.md`.

## Related docs

- `docs/production/PUBLIC_LAUNCH_OPS_CHECKLIST.md`
- `docs/production/EXTERNAL_OPS_MANUAL.md` (Stripe Connect Africa)
- `docs/production/STRIPE_WEBHOOK_VERIFICATION.md`
