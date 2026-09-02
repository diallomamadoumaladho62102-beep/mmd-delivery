# Payout money stages (driver / restaurant / seller)

MMD uses **separate charges + Stripe Connect transfers (SCT)**, then **Sunday 04:00 America/New_York** bank sweeps.

## Stages (do not conflate)

| Stage | Meaning | When (taxi default) |
|-------|---------|---------------------|
| 1. Trip/order completed | Commission calculated in DB | Immediately on complete |
| 2. SCT (`tr_*`) | Platform → Connect account | Immediately after complete (`TAXI_PAYOUT_HOLD_HOURS=0`) |
| 3. Connect **pending** | Stripe settlement in progress | Stripe-controlled timing |
| 4. Connect **available** | Cashable on Connect | After Stripe releases pending |
| 5. Bank payout (`po_*`) | Connect → verified bank | Sunday **04:00–04:59 ET** cron |
| 6. `payout.paid` | Funds arrived at bank | Stripe webhook |

## Sunday 04:00 ET

- Pays **100% of Connect `balance.available` only** — not pending, not awaiting SCT.
- **No MMD cut-off** excluding Saturday 23:59 trips; eligibility is Stripe availability at 04:00.
- Idempotency: `driver_sunday_bank_payout:{acct}:{YYYY-MM-DD_ET}`.

## Saturday 23:59 → Sunday 04:00

1. Ride completes → SCT attempted → `driver_transfer_id` set if OK.
2. If Stripe still shows **pending** at 04:00, bank payout **skips** that amount (not lost — retries next Sunday when available).
3. If **available** before 04:00, amount is included in the bank sweep.

## Reconciliation

- SCT without ledger: `reconcileSuccessfulStripeOrderPayoutIfNeeded` (food/package).
- Bank payout without local row: `ensureSundayBankPayoutAuditRecord`.
