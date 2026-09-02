# Payout money stages (driver / restaurant / seller)

MMD uses **separate charges + Stripe Connect transfers (SCT)**, then **Sunday America/New_York** bank sweeps of Connect `available`. Instant Cash Out is the mid-week fast path when Stripe allows Instant.

## Stages (do not conflate)

| Stage | Meaning | When (taxi / food / package default) |
|-------|---------|--------------------------------------|
| 1. Payment confirmed | Client PaymentIntent / Checkout succeeded | On pay |
| 2. Earnings calculated | Commission snapshot + worker share | On complete / delivered |
| 3. SCT (`tr_*`) | Platform → Connect account | **Immediately** after eligible (`TAXI_PAYOUT_HOLD_HOURS` default **0**) |
| 4. Connect **pending** | Stripe settlement in progress | Stripe-controlled |
| 5. Connect **available** | Cashable on Connect (standard) | After Stripe releases pending |
| 6a. Instant Cash Out (`po_*` Instant) | User-initiated → Instant dest | When Instant-eligible |
| 6b. Bank payout (`po_*` standard) | Connect → verified `ba_*` | Sunday **04:00** ET primary + **16:00** ET catch-up |
| 7. `payout.paid` | Funds arrived / Instant settled | Stripe webhook |
| 8. `payout.failed` | Bank/Instant failed | Stripe webhook → local status |

## Delay matrix

| Delay | Source | Controlled by MMD? | Removable? |
|-------|--------|--------------------|------------|
| SCT after complete | Code path + daily retry | Yes | **Already 0** hold; keep env at 0 |
| Marketplace seller admin approve | Product gate | Yes | **Business decision** — keep unless founder removes |
| Connect pending → available | Stripe settlement | No | Cannot remove |
| Instant Cash Out eligibility | Stripe Instant caps/dest | No | User/Stripe |
| Bank Instant vs standard ACH | Stripe + bank | No | Cannot remove |
| Sunday bank windows | MMD cron | Yes | Primary **required**; catch-up added for same-day available |

## Sunday bank payouts (OBLIGATORY)

- **04:00–04:59 ET** — primary weekly safety sweep of **100% Connect `balance.available`**.
- **16:00–16:59 ET** — catch-up for funds that became available **after** 04:00 the same Sunday (distinct Stripe idempotency keys).
- Pays **available only** — never pending, never “awaiting SCT”.
- **No MMD cut-off** excluding Saturday 23:59 trips; eligibility is Stripe availability at window time.
- GH Actions dual UTC schedules per window (EDT/EST). Handler gates on NY local hour.

## Saturday 23:59 → Sunday 04:00 / 16:00

1. Ride completes → SCT attempted → `driver_transfer_id` set if OK (**does not wait for Sunday**).
2. If still **pending** at 04:00 → morning bank skip for that amount (not lost).
3. If **available** by 04:00 → included in morning sweep.
4. If becomes **available** at 10:00 Sunday → Instant Cash Out if eligible, else **16:00 catch-up** includes it.
5. If becomes available Monday+ → Instant Cash Out if eligible, else next Sunday.

## Mid-week available (not Instant-eligible)

No aggressive polling. Options:

1. User completes Instant-eligible destination → Instant Cash Out.
2. Wait for next Sunday primary/catch-up.

Daily automatic weekday bank sweeps are **not** enabled (preserves Instant + Sunday model).

## Reconciliation

- SCT without ledger: `reconcileSuccessfulStripeOrderPayoutIfNeeded`.
- Bank payout without local row: `ensureSundayBankPayoutAuditRecord` (idempotent on `po_*`).

## Sources of truth

| Concern | SoT |
|---------|-----|
| Payment | Stripe PaymentIntent / charge + MMD payment columns |
| Transfer / SCT | Stripe `tr_*` + `driver_transfer_id` / `stripe_transfer_id` |
| Earnings | Commission snapshot / order_commissions (server) |
| Ledger | `wallet_ledger` + payout_transactions (idempotent keys) |
| Bank payout | Stripe `po_*` + `payout_transactions.external_reference` |
| Paid | Stripe `payout.paid` (never mark paid on create) |
