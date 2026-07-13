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
also runs `assertSettlementMatchesExpectation` (user / service_type / entity
policy). The expectation is wired **without duplicating logic** through three
shared surfaces:

- `verifyStripePaidMatches{Order,DeliveryRequest,TaxiRide}` — now accept an
  optional `expectation` and run the policy after amount/currency checks.
- `assertWebhookEntityMetadata(...)` — a small adapter in the shared webhook
  that runs the policy against the signed metadata before any mark-paid.
- `handleMarketplaceStripePayment` — calls the primitive directly.

| # | Path | File · function | PI-succeeded | Expectation | Controls asserted (beyond amount/currency) |
|---|---|---|---|---|---|
| 1 | food client confirm | `app/api/stripe/client/confirm-paid/route.ts` · PI path **and** session path | ✅ | ✅ **applied** | `user ∈ {created_by, client_user_id}` · `service_type=food` · `entity=order_id/orderId` |
| 2 | food webhook | `app/api/stripe/webhook/route.ts` · `checkout.session.completed` **and** `payment_intent.succeeded` order branches (before `markOrderPaidRobustly`) | ✅ | ✅ **applied** | `user ∈ {client_user_id, created_by, user_id}` · `service_type=food` · `entity=order_id` |
| 3 | marketplace confirm | — | — | **N/A** | No client→`paid` transition exists; marketplace settles **only** via the webhook (`app/api/marketplace/checkout/**` never marks paid). |
| 4 | marketplace webhook | `src/lib/marketplaceStripeWebhook.ts` · `handleMarketplaceStripePayment` | ✅ | ✅ **applied** | `user=client_user_id` · `service_type=marketplace` · `entity=seller_order_id` |
| 5 | taxi client confirm | `app/api/stripe/client/confirm-taxi-paid/route.ts` → `verifyStripePaidMatchesTaxiRide` | ✅ | ✅ **applied** | `user=client_user_id` · `service_type=taxi` · `entity=taxi_ride_id/ride_id` |
| 6 | taxi webhook | `src/lib/taxiStripeWebhook.ts` · `handleTaxiStripePayment` | ✅ | ✅ **applied** | `user` · `service_type=taxi` · `entity=taxi_ride_id` |
| 7 | delivery client confirm | `app/api/stripe/mark-delivery-request-paid/route.ts` **and** `app/api/stripe/client/confirm-delivery-request-paid/route.ts` → `verifyStripePaidMatchesDeliveryRequest` | ✅ | ✅ **applied** | `user ∈ {created_by, client_user_id}` · `service_type=delivery` · `entity=delivery_request_id` |
| 8 | delivery webhook | `app/api/stripe/webhook/route.ts` · both handlers' delivery branches (before `markDeliveryRequestPaidRobustly`) | ✅ | ✅ **applied** | `user ∈ {created_by, client_user_id}` · `service_type=delivery` · `entity=delivery_request_id` |

**Result: 7/7 real paths covered + 1 N/A (marketplace confirm).**

The user check uses a **candidate list** (`userIds`) because a resource may have
distinct legitimate owner columns (`created_by` vs `client_user_id`) while the
PI records only the single checkout initiator; a versioned PI is still blocked
when its `user_id` matches *none* of the candidates.

## Collision protection

**Within a table** (same PI on two rows of the same table): enforced at the DB
by partial unique indexes added in
`supabase/migrations/20260804120000_payment_intent_uniqueness.sql`
(`orders`, `seller_orders`, `delivery_requests`; `taxi_rides` already had
`taxi_rides_stripe_pi_uq`).

**Between tables** (same PI in e.g. `orders` and `taxi_rides`): this is an
**application-level** control, **not** a global PostgreSQL constraint. Every
settlement path now rejects a PI whose signed `service_type` or business entity
id does not match the resource actually loaded — so a Taxi PI presented to a
food order is rejected by the `service_type` check (`food` ≠ `taxi`), and a food
PI presented to a delivery request is rejected likewise. Two independent layers
therefore apply:

1. per-table partial unique indexes (in-table uniqueness), and
2. the expectation check at settlement (cross-service / wrong-entity / wrong-user).

There is **no** global cross-table registry of PaymentIntents; the architecture
does not require one because layers (1)+(2) already reject every known replay.
The offline audit `docs/production/sql/payment_intent_integrity_audit.sql`
detects any pre-existing cross-table collisions before the migration is applied.

## Residual risks / to-do (honest)

- **R1 — resolved.** The metadata policy is now applied on **all** 7 real
  settlement paths (food/marketplace/taxi/delivery, client + webhook); #3 is
  N/A. Amount/currency were already validated on every path before this change.
- **R2 — resolved (application-level).** Cross-service PI rejection is active on
  all paths via `service_type` + entity + user. It remains an application
  control, **not** a DB constraint (documented above).
- **R3** — Historical (unversioned) PIs remain in tolerant mode by design until
  they age out (`verify-if-present`): a present-but-wrong field is rejected, a
  *missing* field is tolerated. Intentional backward-compat, not permanent.
- **R4** — The `metadata_schema_version` marker is written going forward only;
  PaymentIntents created before this PR are treated as historical.
- **R5** — The RPC/UPDATE "not called on validation failure" invariant is
  covered by unit + handler-level tests (marketplace handler with a mocked
  Supabase client). Full PostgreSQL-integration coverage of `mark_order_paid` /
  `mark_taxi_ride_paid` under concurrency is out of scope for this PR.
