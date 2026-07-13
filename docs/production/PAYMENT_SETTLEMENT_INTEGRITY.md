# Payment settlement integrity

Single rule: **no resource becomes `paid` until Stripe confirms the underlying
PaymentIntent has `status === "succeeded"`** (a Checkout Session's
`payment_status` is never trusted on its own). Implemented by
`apps/web/src/lib/requirePaymentIntentSucceeded.ts`.

## Metadata policy (versioned)

Every **new** PaymentIntent is stamped by its creator with
`metadata_schema_version` (`PAYMENT_METADATA_SCHEMA_VERSION = "1"`) plus the
business fields below. Strictness is keyed off that marker:

| PI kind | Detection | Rule for required fields (`user`, `service_type`, entity id) |
|---|---|---|
| **New** | metadata has `metadata_schema_version` | Field MUST be present **and** match. Missing required field ⇒ `paid` is **blocked** (`metadata_<field>_missing_on_versioned_pi`). |
| **Historical** | no `metadata_schema_version` | Verify **if-present** only: a positive mismatch is rejected, a missing value is tolerated. Bounded, documented backward-compat window — **not** the permanent rule. |

`amount` / `currency` are always verified when the caller passes them.
`quote_id` is optional even on new PIs (only some flows are quote-first).

### Metadata written at PaymentIntent creation

| Service | Creator | version | service_type | user key | entity id key |
|---|---|---|---|---|---|
| food | `app/api/stripe/client/create-checkout-session/route.ts` | ✅ | `food` | `user_id` | `order_id`/`orderId` |
| delivery | `app/api/stripe/client/create-delivery-request-checkout-session/route.ts` | ✅ | `delivery` | `user_id` | `delivery_request_id`/… |
| taxi | `app/api/stripe/client/create-taxi-checkout-session/route.ts` | ✅ | `taxi` (+ `module`) | `user_id` | `taxi_ride_id`/… |
| marketplace | `src/lib/marketplaceLiveCheckoutService.ts` | ✅ | `marketplace` (+ `module`) | `client_user_id`/`user_id` | `seller_order_id` |

## Settlement-path coverage matrix

`PI-succeeded` = requires `requirePaymentIntentSucceeded`. `expectation` =
also runs `assertSettlementMatchesExpectation` (user/service/entity policy).

| # | Path | File · function | PI-succeeded | Expectation (metadata policy) | Notes |
|---|---|---|---|---|---|
| 1 | food client confirm | `app/api/stripe/client/confirm-paid/route.ts` · session path | ✅ | ❌ **not yet** | Amount/currency/ownership verified via `verifyStripePaidMatchesOrder`; metadata policy NOT applied. |
| 2 | food webhook | `app/api/stripe/webhook/route.ts` (`payment_intent.succeeded` / `checkout.session.completed`) → `mark_order_paid` / `verifyStripePaidMatchesOrder` | ✅ | ❌ **not yet** | Routed by metadata entity id; service_type not asserted. |
| 3 | marketplace confirm | success redirect → webhook | ✅ (via #4) | ❌ **not yet** | Live checkout OFF by default. |
| 4 | marketplace webhook | `src/lib/marketplaceStripeWebhook.ts` · `handleMarketplaceStripePayment` | ✅ (session PI resolved) | ❌ **not yet** | Amount/currency/session verified; metadata policy NOT applied. |
| 5 | taxi client confirm | `app/api/stripe/client/confirm-taxi-paid/route.ts` → `verifyStripePaidMatchesTaxiRide` | ✅ | ❌ **not yet** | Ride ownership checked separately; metadata policy NOT applied here. |
| 6 | **taxi webhook** | `src/lib/taxiStripeWebhook.ts` · `handleTaxiStripePayment` | ✅ | ✅ **applied** | Enforces `user` + `service_type=taxi` + `entity=taxi_ride_id` (versioned strict / historical tolerant). |
| 7 | delivery client confirm | `app/api/stripe/mark-delivery-request-paid/route.ts` → `verifyStripePaidMatchesDeliveryRequest` | ✅ | ❌ **not yet** | Amount/currency/ownership verified; metadata policy NOT applied. |
| 8 | delivery webhook | `app/api/stripe/webhook/route.ts` → `verifyStripePaidMatchesDeliveryRequest` | ✅ | ❌ **not yet** | Routed by metadata entity id; service_type not asserted. |

## Collision protection

**Within a table** (same PI on two rows of the same table): enforced at the DB
by partial unique indexes added in
`supabase/migrations/20260804120000_payment_intent_uniqueness.sql`
(`orders`, `seller_orders`, `delivery_requests`; `taxi_rides` already had
`taxi_rides_stripe_pi_uq`).

**Between tables** (same PI in e.g. `orders` and `taxi_rides`): **NOT** enforced
by the per-table indexes. During settlement it is enforced **only where the
expectation check runs** — currently path #6 (taxi webhook), which rejects a PI
whose `service_type` / entity id do not match. For paths #1–#5, #7–#8 the
cross-service rejection is **not yet active**; those paths are protected only
indirectly (settlement is routed by the PI's own metadata entity id, and the
row's stored `stripe_payment_intent_id` is matched), which makes a cross-table
replay unlikely-by-construction but **not server-rejected**. The audit script
`docs/production/sql/payment_intent_integrity_audit.sql` detects existing
cross-table collisions offline.

## Residual risks / to-do (honest)

- **R1** — Metadata policy enforced at settlement on **taxi webhook only**.
  Paths #1–#5, #7, #8 do not yet call `assertSettlementMatchesExpectation`, so a
  *new* PI missing required metadata would still be able to settle those. Wiring
  them is deferred to keep this PR contained (no behaviour change to working
  flows).
- **R2** — Cross-service PI rejection is active only on the taxi webhook (see
  above). Generalising it to all paths is the follow-up.
- **R3** — Historical (unversioned) PIs remain in tolerant mode by design until
  they age out; this is intentional backward-compat, not a permanent stance.
- **R4** — The `metadata_schema_version` marker is set going forward; PaymentIntents
  created before this PR will not carry it and are treated as historical.
