# Historical mirror-order PaymentIntent cleanup (2026-07-13)

## Summary

Three historical `orders` rows (kind `pickup_dropoff`) shared the same Stripe
`stripe_payment_intent_id` as their linked `delivery_requests`. This was **not**
a double charge or fraud: it came from an abandoned co-creation architecture
(delivery request + driver-facing mirror order) used in April 2026 test payments.

**Payment source of truth:** `delivery_requests`.

## What was fixed

On project `mmd_delivery` (`sjmszohmhudayxawfows`), exactly three orders had:

- `stripe_payment_intent_id` set to `NULL`
- `stripe_session_id` set to `NULL`

No other financial fields were intentionally changed. `updated_at` advanced via
existing `BEFORE UPDATE` triggers on `orders`.

| Order id | Linked delivery_request | PaymentIntent (kept on DR) |
|---|---|---|
| `9aa30884-d7e2-4df8-b871-4921f64b6608` | `92f87f47-c228-498a-94e4-6e6a2759d1b7` | `pi_3TK9QbARYL6CPXX20t9IZAjd` |
| `e7751184-5bf7-4db0-bb84-46308a204084` | `f3303ae3-552d-466d-ad35-7ae36386866d` | `pi_3TKCANARYL6CPXX22K1ftx1f` |
| `4fbd3968-4709-4578-af78-c81e3c19c6e6` | `7fa39fad-6461-4cda-a0a6-a33531215ffd` | `pi_3TKZH9ARYL6CPXX21zqLZLu4` |

## Proof current code does not reproduce the duplication

`syncPaidDeliveryRequestOrder` in `apps/web/src/lib/deliveryRequestService.ts`
inserts the mirror order with `payment_status: "paid"` and `external_ref_*`,
but **does not** set `stripe_payment_intent_id` or `stripe_session_id`.

Checkout for delivery writes Stripe refs only on `delivery_requests`
(`create-delivery-request-checkout-session`).

## Artifacts

| File | Role |
|---|---|
| `docs/production/sql/backup_historical_mirror_order_pi_20260713.json` | Pre-correction backup |
| `docs/production/sql/fix_historical_mirror_order_pi_collision.sql` | Targeted transactional fix |
| `docs/production/sql/verify_historical_mirror_order_pi_fix.sql` | Post-fix verification |
| `docs/production/sql/payment_intent_integrity_audit_cli.sql` | CLI-readable audit (result set) |
| `docs/production/sql/payment_intent_integrity_audit.sql` | Canonical NOTICE-based audit (unchanged, still strict) |

## Migration

After audit returned `SAFE_TO_APPLY_UNIQUE_CONSTRAINTS = true`:

```bash
npx supabase@2.109.1 db push --linked
```

Applied: `20260804120000_payment_intent_uniqueness.sql`

Indexes now present (all partial `WHERE stripe_payment_intent_id IS NOT NULL`):

- `orders_stripe_pi_uq`
- `seller_orders_stripe_pi_uq`
- `delivery_requests_stripe_pi_uq`
- `taxi_rides_stripe_pi_uq` (pre-existing, reasserted)

RPC `mark_taxi_ride_paid(uuid, text, text)`:

- `anon` — no EXECUTE
- `authenticated` — no EXECUTE
- `service_role` — EXECUTE

## Conclusion

`DATA_FIXED_MIGRATION_APPLIED`
