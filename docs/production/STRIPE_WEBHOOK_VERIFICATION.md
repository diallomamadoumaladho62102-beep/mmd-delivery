# Stripe webhook — single-handler verification

## Canonical handler (production)

| Item | Value |
|------|--------|
| URL | `https://www.mmddelivery.com/api/stripe/webhook` |
| Code | `apps/web/app/api/stripe/webhook/route.ts` |
| Idempotency | `public.stripe_webhook_events.stripe_event_id` (UNIQUE) |

## Supabase Edge (must NOT process live events)

| Item | Value |
|------|--------|
| Function | `supabase/functions/stripe_webhook/index.ts` |
| Disable env | `MMD_STRIPE_WEBHOOK_DISABLED=true` |
| Fail-closed | Edge returns **410** unless `MMD_STRIPE_WEBHOOK_EDGE_ENABLED=true` |

## Verification probes

After deploy, run:

```bash
curl -s https://www.mmddelivery.com/api/health/stripe-webhook
```

Expected:

- `canonical_webhook_url` = Vercel URL above
- `edge_webhook_must_be_disabled` = true
- `recent_webhook_events_24h.count` > 0 after a live payment test

## Stripe Dashboard checklist

1. **One** webhook endpoint → Vercel URL only
2. Events (Live, aligned on `apps/web/app/api/stripe/webhook/route.ts`):
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
   - plus subscription/invoice events if Billing is live
3. No Supabase project URL in webhook list
4. Supabase Edge secrets: `MMD_STRIPE_WEBHOOK_DISABLED=true`

## Proof query (Supabase SQL)

```sql
select stripe_event_id, event_type, created_at
from public.stripe_webhook_events
order by created_at desc
limit 5;
```

Each live payment must appear **once**.
