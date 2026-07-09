# Production ops: CRON_SECRET + Universal Links

## CRON_SECRET (required in production)

Production cron auth rejects `x-vercel-cron` alone. Every scheduled job must send:

- `Authorization: Bearer <CRON_SECRET>` and/or
- `x-cron-secret: <CRON_SECRET>`

### One-time setup

1. Generate a long random secret (32+ bytes).
2. Set `CRON_SECRET` in **Vercel → Project → Settings → Environment Variables** (Production).
3. Sync the same value to GitHub Actions:

```bash
# From repo root, with CRON_SECRET exported and gh authenticated:
node scripts/sync-github-cron-secret.mjs
```

4. Verify:

```bash
CRON_SECRET=... node scripts/verify-production-crons.mjs --check-github-secret
```

Expected: unauthenticated probes return 401; authenticated probes are not 401/403.

5. After GitHub dispatch workflows succeed for 24h, set local certification flag `EXTERNAL_DISPATCH_CRON_CONFIGURED=true` (never commit secrets).

### Routes covered

| Source | Routes |
|--------|--------|
| Vercel `vercel.json` | `/api/admin/process-payouts`, `/api/orders/expire-unpaid`, `/api/cron/taxi-monitoring-snapshot`, `/api/cron/vehicle-eligibility-refresh` |
| GitHub Actions | retry-order/taxi/delivery-request-dispatch, taxi-scheduled-dispatch, taxi-active-ride-compliance, ride-safety-recording-retention |

Money probe for `process-payouts` is skipped unless `CERTIFICATION_ALLOW_PAYOUT_CRON=true`.

---

## Universal Links / App Links (iOS + Android)

Canonical Expo config is **root** `app.config.ts` (EAS builds). `apps/mobile/app.json` is kept in sync for associated domains / intent filters.

### Native config (already in repo)

- iOS `associatedDomains`: `applinks:www.mmddelivery.com`, `applinks:mmddelivery.com`
- Android `intentFilters` with `autoVerify: true` for both hosts
- Web well-known:
  - `apps/web/public/.well-known/apple-app-site-association`
  - `apps/web/public/.well-known/assetlinks.json`

### Rebuild requirements (mandatory after changing deep-link config)

Universal links are baked into the **native binary**. Changing `associatedDomains` / `intentFilters` requires a new EAS build — OTA/`expo-updates` alone is not enough.

```bash
# Production store binaries
eas build --platform ios --profile production
eas build --platform android --profile production
```

Then:

1. Confirm AASA is served without redirects at `https://www.mmddelivery.com/.well-known/apple-app-site-association`
2. Confirm `assetlinks.json` SHA-256 matches the Play App Signing certificate
3. Device smoke: open `https://www.mmddelivery.com/orders/...` and verify the app opens (not only Safari/Chrome)

### Scheme

Custom scheme remains `mmddelivery://` for in-app / push deep links.
