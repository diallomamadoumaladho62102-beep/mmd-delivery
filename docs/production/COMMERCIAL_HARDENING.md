# Commercial production hardening (2026-06-03)

## Migration

Apply after prior H2/H3 migrations:

`supabase/migrations/20260603130000_commercial_production_hardening_v2.sql`

Then apply:

`supabase/migrations/20260604120000_production_payment_commission_hardening.sql`

**Do not apply** `20260603120000_commercial_production_hardening.sql` (deprecated).

## Env / secrets (unchanged + confirm)

| Variable | Where |
|----------|--------|
| `MMD_STRIPE_WEBHOOK_DISABLED=true` | Supabase Edge `stripe_webhook` |
| `MMD_EDGE_PAYOUTS_DISABLED=true` | All Edge payout functions including `pay_restaurant_now`, `pay-driver-now` |
| `MMD_PAYOUT_MODE` | Vercel — `hybrid` (default), `weekly`, or `immediate` (see `PAYOUTS_SINGLE_HANDLER.md`) |
| `CRON_SECRET` | Vercel |
| `STRIPE_TRANSFERS_ADMIN_SECRET` | Vercel |
| EAS secrets | `EXPO_PUBLIC_STRIPE_PK`, Supabase, Mapbox, `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` |

## Low-risk items addressed

| Item | Mitigation |
|------|------------|
| Public `/api/ping` | Production requires `CRON_SECRET` (Bearer or `x-cron-secret`) |
| Twilio GET probes | `voice` + `sms` return **405** in production |
| Dev LAN IP in `eas.json` | Dev profile only; production uses `EXPO_PUBLIC_API_URL_PROD` |
| `confirm_checkout_session` | Edge returns **410** (documented) |
| Edge batch payouts | Disabled via `MMD_EDGE_PAYOUTS_DISABLED` |
| `expo-updates` | `runtimeVersion` + `updates.url` in root `app.config.ts` |
| Duplicate `apiBase` | `apps/mobile/src/lib/apiBase.ts` re-exports canonical `lib/apiBase.ts` |

## Universal links ops

1. Replace `TEAMID` in `apps/web/public/.well-known/apple-app-site-association` with Apple Team ID.
2. Replace SHA256 in `assetlinks.json` with Play Console signing cert fingerprint.

## Verification SQL

```sql
-- Payout state machine
select id, order_id, target, status, stripe_transfer_id, locked_at, succeeded_at
from public.order_payouts
order by created_at desc
limit 20;

-- No duplicate succeeded payouts
select order_id, target, count(*)
from public.order_payouts
where status = 'succeeded'
group by 1, 2 having count(*) > 1;
```
