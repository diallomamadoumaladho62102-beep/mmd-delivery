# Dispatch cron strategy (Hobby / Pro compatible)

MMD Delivery uses **Vercel cron** for low-frequency jobs and **external cron** (or Vercel Pro) for dispatch retries.

## Scheduled in `vercel.json` (Hobby-safe)

| Schedule (UTC) | Path | Purpose |
|----------------|------|---------|
| Sun 03:00 | `/api/admin/process-payouts` | Weekly payout batch |
| Daily 05:00 | `/api/orders/expire-unpaid` | Expire stale unpaid orders |
| Daily 06:00 | `/api/cron/taxi-monitoring-snapshot` | Taxi ops monitoring |

These routes accept `CRON_SECRET` or Vercel cron headers.

## External cron required (not in Hobby `vercel.json`)

Configure in **GitHub Actions**, **cron-job.org**, or **Vercel Pro** crons:

| Interval | Path | Secret header |
|----------|------|---------------|
| Every 2–5 min | `/api/cron/retry-order-dispatch` | `Authorization: Bearer $CRON_SECRET` |
| Every 2–5 min | `/api/cron/retry-taxi-dispatch` | same |
| Every 1–5 min | `/api/cron/taxi-scheduled-dispatch` | same |

Optional monitoring:

| Daily | `/api/monitoring` | `CRON_SECRET` or `MONITORING_SECRET` |

## Ops checklist

1. Set `CRON_SECRET` in Vercel production.
2. Point external cron at `https://www.mmddelivery.com/api/cron/...`.
3. Verify `/api/health` returns `platform_countries.ok: true`.
4. Do **not** add sub-hour crons to `vercel.json` on Hobby (deploy will fail).

See also `docs/production/EXTERNAL_OPS_MANUAL.md`.
