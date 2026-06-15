# External ops manual — Production Ready 100%

Items below cannot be completed in code alone. Execute manually before commercial launch.

## Supabase migrations (production)

Apply in order after current prod head:

1. `20260624120000_platform_countries_launch_control.sql`
2. `20260625120000_production_p0_p1_closure.sql`

Verify:

```sql
select count(*) from public.platform_countries;
select country_code, is_active from public.mmd_zones where country_code in ('SN','CI','ML','SL','MR');
```

## Vercel

- **Hobby plan:** Vercel only allows daily cron schedules. High-frequency dispatch crons (`retry-order-dispatch`, `retry-taxi-dispatch`, `taxi-scheduled-dispatch`) must use an **external cron** (e.g. cron-job.org) hitting those URLs with `CRON_SECRET`, or upgrade to **Vercel Pro**.
- Active Vercel crons (daily): `process-payouts`, `expire-unpaid`, `taxi-monitoring-snapshot`
- Confirm env: `CRON_SECRET`, `DISPATCH_INTERNAL_SECRET`, `MMD_PAYOUT_MODE=hybrid`
- Health check: `GET https://www.mmddelivery.com/api/health`
- Stripe webhook health: `GET https://www.mmddelivery.com/api/health/stripe-webhook`

## Supabase Edge

- `MMD_STRIPE_WEBHOOK_DISABLED=true` on Edge `stripe_webhook`
- `MMD_EDGE_PAYOUTS_DISABLED=true` on payout Edge functions
- Redeploy `create_connect_account` after migration (country-aware Connect)

## Stripe Connect country audit

Run after deploying `create_connect_account` with country support:

```bash
node scripts/verify-stripe-connect-countries.mjs --report-only
node scripts/verify-stripe-connect-countries.mjs --suggest-reset
```

Stripe Express `country` is immutable. Mismatched accounts must be reset in DB and re-onboarded.

## Monitoring

- Health: `GET /api/health`
- Monitoring snapshot: `GET /api/monitoring` with `Authorization: Bearer $MONITORING_SECRET`
- Optional alerts: set `MONITORING_WEBHOOK_URL` (Slack-compatible JSON webhook)

## Stripe Connect — Africa (manual)

Code now passes `country` when creating Express accounts and allows GNF/XOF/SLE/MRU checkout/payout currency guards.

Ops still required per country:

1. Enable Stripe Connect capabilities for GN/SN/CI/ML/SL/MR in Stripe Dashboard
2. Complete KYC test with one driver + one restaurant per market
3. Enable `payout_enabled` in `/admin/platform-launch` only after successful Connect onboarding
4. Run one taxi payout + one food payout smoke per market

## Smoke Live sign-off

Execute and sign `docs/production/READINESS_100_CHECKLIST.md`:

1. Web food checkout → paid → dispatch → delivered → payout
2. Mobile PaymentSheet → no duplicate Checkout (C1)
3. Delivery request pay → dispatch wave 1
4. Taxi quote → pay → complete → payout (western market first)
5. Cron retry endpoints with `CRON_SECRET`

## App Store / Google Play

- iOS: EAS submit configured (`ascAppId` in root `eas.json`)
- Android: set Play Console `serviceAccountKeyPath` in `eas.json` submit.production.android
- Set real store URLs in Vercel env (`NEXT_PUBLIC_APP_STORE_URL`, `NEXT_PUBLIC_PLAY_STORE_URL`)
- Complete Apple Team ID in `apple-app-site-association` and Play SHA256 in `assetlinks.json`

## Legal / GDPR

- Counsel review of `/legal/privacy`, `/legal/terms`, `/legal/support`
- GDPR data export/deletion process documented for support
- Background location + photo proof disclosures validated for store review

## Monitoring (optional but recommended)

- Sentry DSN for web (`NEXT_PUBLIC_SENTRY_DSN`) and mobile (`EXPO_PUBLIC_SENTRY_DSN`)
- Alerting on webhook failures, cron 5xx, `taxi_*_alerts` threshold

## Africa commercial launch sequence

1. `/admin/platform-launch` — enable target country (taxi/delivery/restaurant/checkout as needed)
2. `/admin/taxi-launch` — enable taxi for same country
3. Activate drivers + zones in admin
4. Field test Android + iOS per country before `payout_enabled=true`
