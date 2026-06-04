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

## Verification

After deploy, send a test event from Stripe Dashboard to the Vercel URL only. Confirm `stripe_webhook_events` (or order `payment_status`) updates once per event.
