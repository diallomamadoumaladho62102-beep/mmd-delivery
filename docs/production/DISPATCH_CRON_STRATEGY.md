# Dispatch cron strategy (Hobby / Pro compatible)

MMD Delivery uses **Vercel cron** for low-frequency jobs and **GitHub Actions** (or cron-job.org / Vercel Pro) for high-frequency dispatch retries.

## Scheduled in `vercel.json` (Hobby-safe — daily/weekly only)

| Schedule (UTC) | Path | Purpose |
|----------------|------|---------|
| Sun 03:00 | `/api/admin/process-payouts` | Weekly payout batch |
| Daily 05:00 | `/api/orders/expire-unpaid` | Expire stale unpaid orders |
| Daily 06:00 | `/api/cron/taxi-monitoring-snapshot` | Taxi ops monitoring |
| Daily 00:05 | `/api/cron/vehicle-eligibility-refresh` | Driver vehicle category eligibility |

These routes accept `CRON_SECRET`, `x-cron-secret`, or Vercel cron headers.

## External cron (GitHub Actions — `.github/workflows/production-dispatch-crons.yml`)

Runs every **3 minutes** with `Authorization: Bearer $CRON_SECRET`:

| Path | Purpose |
|------|---------|
| `/api/cron/retry-order-dispatch` | Food / order dispatch waves 2–3 |
| `/api/cron/retry-taxi-dispatch` | Taxi orphan + favorite fallback retries |
| `/api/cron/retry-delivery-request-dispatch` | Package dispatch waves 2–3 |
| `/api/cron/taxi-scheduled-dispatch` | Scheduled taxi rides |
| `/api/cron/taxi-active-ride-compliance` | Active taxi ride compliance |

## External cron (GitHub Actions — `.github/workflows/production-safety-retention-cron.yml`)

Runs every **6 hours** with `Authorization: Bearer $CRON_SECRET`:

| Path | Purpose |
|------|---------|
| `/api/cron/ride-safety-recording-retention` | Safety recording retention |

### GitHub setup

1. Add repository secret `CRON_SECRET` (same value as Vercel production).
2. Optional repository variable `PRODUCTION_SITE_URL` (default `https://www.mmddelivery.com`).
3. Set `EXTERNAL_DISPATCH_CRON_CONFIGURED=true` in Vercel after first successful workflow run.

### Verification

```bash
node scripts/verify-production-crons.mjs
CRON_SECRET=... node scripts/verify-production-crons.mjs
```

## Ops checklist

1. Set `CRON_SECRET` in Vercel production **and** GitHub Actions secrets.
2. Confirm GitHub workflow `Production dispatch crons` is enabled on `main`.
3. Verify `/api/health` returns `platform_countries.ok: true`.
4. Do **not** add sub-hour crons to `vercel.json` on Hobby (deploy will fail).

See also `docs/production/EXTERNAL_OPS_MANUAL.md`.
