# Payout money stages (driver / restaurant / seller)

**Decision (Option A + B):** Keep **separate charges + transfers**. Do **not** migrate to destination/direct charges. Maximize partner speed by removing artificial MMD delays and making Instant Cash Out as clear/fast as Stripe allows.

MMD uses **separate charges + Stripe Connect transfers (SCT)**, then **Sunday 04:00 America/New_York** bank sweep of Connect `available`. Instant Cash Out is the mid-week fast path when Stripe allows Instant.

**There is NO Sunday 16:00 catch-up and NO daily automatic bank sweep.**

## Stages (do not conflate)

| Stage | Meaning | When (taxi / food / package default) |
|-------|---------|--------------------------------------|
| 1. Payment confirmed | Client PaymentIntent / Checkout succeeded | On pay |
| 2. Earnings calculated | Commission snapshot + worker share | On complete / delivered |
| 3. SCT (`tr_*`) / TRANSFERRED | Platform → Connect account | **Immediately** (`TAXI_PAYOUT_HOLD_HOURS` default **0**) |
| 4. Connect **pending** | Stripe settlement in progress | Stripe-controlled |
| 5. Connect **available** | Standard available on Connect | After Stripe releases pending |
| 6a. Instant Cash Out (`po_*` Instant) | User-initiated when Instant-eligible | Stripe Instant rules |
| 6b. Bank payout (`po_*` standard) | Connect → verified `ba_*` | Sunday **04:00–04:59 ET only** |
| 7. `payout.paid` / PAID | Funds arrived / Instant settled | Stripe webhook |
| 8. `payout.failed` | Bank/Instant failed | Stripe webhook → local status |

**UX rule:** never present pending/settling as cashable Instant balance. `available_cents` for Cash Out = Instant-cashable only.

## Delay matrix

| Delay | Source | Controlled by MMD? | Removable? |
|-------|--------|--------------------|------------|
| SCT after complete | Code path + daily retry | Yes | **Already 0** hold; keep env at 0 |
| Marketplace seller admin approve | Product gate | Yes | Keep (business decision) |
| Connect pending → available | Stripe settlement | No | Cannot remove |
| Instant Cash Out eligibility | Stripe Instant caps/dest | No | User/Stripe |
| Bank Instant vs standard ACH | Stripe + bank | No | Cannot remove |
| Sunday 04:00 bank | MMD cron | Yes | **Required** — sole automatic bank payout |

## Sunday 04:00 ET (OBLIGATORY — sole automatic bank payout)

- Pays **100% of Connect `balance.available` only** — not pending, not awaiting SCT.
- **No MMD cut-off** excluding Saturday 23:59 trips; eligibility is Stripe availability at 04:00.
- Idempotency: `driver_sunday_bank_payout:{acct}:{YYYY-MM-DD_ET}`.
- GH Actions dual UTC schedules (EDT/EST). Handler gates on NY local hour === 4.
- Funds that become available **after** 04:00 stay on Connect until Instant Cash Out or **next** Sunday 04:00.

## Saturday 23:59 → Sunday 04:00

1. Ride completes → SCT attempted immediately → `driver_transfer_id` if OK.
2. If still **pending** at 04:00 → bank skip for that amount (not lost).
3. If **available** by 04:00 → included in Sunday bank sweep.
4. If becomes available later Sunday/weekday → Instant Cash Out if eligible, else next Sunday 04:00.
5. **No 16:00 catch-up.**

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
