# Stripe webhook — single active handler (production)

## Canonical endpoint (Live)

- **URL:** `https://www.mmddelivery.com/api/stripe/webhook`
- **Implementation:** `apps/web/app/api/stripe/webhook/route.ts` (Vercel)

## Do not use in production

- **Supabase Edge:** `supabase/functions/stripe_webhook/index.ts`
- Set secret **`MMD_STRIPE_WEBHOOK_DISABLED=true`** on the Edge function so duplicate events are not processed.

## Stripe Dashboard checklist

1. Developers → Webhooks → confirm **one** endpoint for Live mode.
2. Endpoint URL must be exactly `https://www.mmddelivery.com/api/stripe/webhook`.
3. Remove or disable any Supabase project URL pointing at `stripe_webhook`.
4. Signing secret must match `STRIPE_WEBHOOK_SECRET` in Vercel production env.
5. Subscribe exactly these Live events (handler in `route.ts`):
   - `account.updated`
   - `account.application.authorized`
   - `capability.updated`
   - `payment_intent.created`
   - `payment_intent.processing`
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `payout.created`
   - `payout.updated`
   - `payout.paid`
   - `payout.failed`
   - `payout.canceled`
   - `transfer.created`
   - `transfer.updated`
   - `transfer.reversed`
   - `charge.refunded`
   - `refund.updated`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.paid`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`

## Event handling notes

| Event | Effect |
|-------|--------|
| `payment_intent.created` / `processing` | Acknowledged + idempotency row only (no money movement) |
| `payment_intent.succeeded` / checkout completed / async succeeded | Mark entity paid + wallet bridge |
| `checkout.session.expired` | Food / DR / taxi → `payment_status=unpaid`; marketplace → `pending_checkout` |
| `payment_intent.payment_failed` / `checkout.session.async_payment_failed` | Food / DR / taxi → `failed` (or unpaid fallback); marketplace → `payment_failed` |
| `account.*` / `capability.updated` | Sync Connect readiness on drivers / restaurants / sellers |
| `transfer.*` | Sync `order_payouts` + marketplace payout rows by `stripe_transfer_id` |
| `payout.created` / `updated` / `paid` / `failed` / `canceled` | Sync `driver_payouts` + `payout_transactions` by Stripe payout id |

## Idempotency table (Vercel webhook)

The Next.js handler records each Stripe `event.id` in **`public.stripe_webhook_events`** (`stripe_event_id` UNIQUE). Duplicate events return early without re-processing.

```sql
select stripe_event_id, event_type, created_at
from public.stripe_webhook_events
order by created_at desc
limit 20;
```

## Verification

After deploy, send a test event from Stripe Dashboard to the Vercel URL only. Confirm `stripe_webhook_events` and order `payment_status` update once per event.
