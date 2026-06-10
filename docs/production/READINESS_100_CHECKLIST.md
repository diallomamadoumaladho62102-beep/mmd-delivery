# Production & commercial readiness 100/100 — gate checklist

Code paths for payment, commissions, dispatch, and legal URLs are in the repo.
**Sign-off items below require human/Ops execution** (not automatable in CI without Live Stripe).

## Vercel env (confirm in dashboard)

| Variable | Required |
|----------|----------|
| `NEXT_PUBLIC_SITE_URL` | `https://www.mmddelivery.com` |
| `STRIPE_WEBHOOK_SECRET` | Live webhook |
| `STRIPE_SECRET_KEY` | `sk_live_*` |
| `SUPABASE_SERVICE_ROLE_KEY` | Production project |
| `CRON_SECRET` | Matches cron routes |
| `DISPATCH_INTERNAL_SECRET` | Dispatch + DR schedule |
| `MMD_PAYOUT_MODE` | `hybrid` recommended |
| `MAPBOX_ACCESS_TOKEN` | Server-only geocode |
| `NEXT_PUBLIC_APP_STORE_URL` | Real App Store listing URL |
| `NEXT_PUBLIC_PLAY_STORE_URL` | Real Play listing URL |

## Supabase migrations (apply in order)

1. `20260604130000_fix_refresh_order_commissions_return_type.sql`
2. `20260604140000_order_commissions_rls.sql`
3. `20260604150000_production_dispatch_hardening.sql`
4. `20260624120000_platform_countries_launch_control.sql`
5. `20260625120000_production_p0_p1_closure.sql`
6. `20260626120000_partial_closure_completion.sql`

See also `docs/production/EXTERNAL_OPS_MANUAL.md` for Stripe Connect Africa, stores, and legal sign-off.

## Smoke test (manual, Live)

1. Web food: `/orders/new` → create → redirect `?pay=1` → Stripe Checkout → paid.
2. Mobile: PaymentSheet → confirm fails → no second Checkout (C1).
3. Delivery request: pay → single driver push wave (check `dispatch_wave_1_started_at`).
4. Delivered → `delivered-confirm` → `transfers/run` → `order_commissions` row exists.
5. Cron: `GET /api/cron/retry-order-dispatch` with `CRON_SECRET` processes `order_dispatch_wave_schedule`.

## App Store / Play Store

- Privacy URL: `https://www.mmddelivery.com/legal/privacy`
- Terms URL: `https://www.mmddelivery.com/legal/terms`
- Support URL: `https://www.mmddelivery.com/legal/support`
- Replace placeholder store URLs in env before store submission.
- Complete Apple Team ID + Play `assetlinks.json` SHA256 (see `COMMERCIAL_HARDENING.md`).

## Edge (confirm)

- `MMD_EDGE_PAYOUTS_DISABLED=true`
- `MMD_STRIPE_WEBHOOK_DISABLED=true` on Edge `stripe_webhook`
