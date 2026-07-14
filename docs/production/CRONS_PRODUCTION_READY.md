# Crons production readiness

## Expiration ownership (no overlap)

| Endpoint | Role | Lock |
|---|---|---|
| `/api/cron/expire-stale-payments` | **Canonical** — orders + delivery_requests + Stripe PI cancel (15m margin) | `payment-expiration` |
| `/api/orders/expire-unpaid` | **Alias** — same runner + same lock (compat for old callers) | `payment-expiration` |

Vercel schedules only the canonical path. Concurrent alias/canonical calls cannot both mutate: shared lease + atomic claim (`payment_status in unpaid|processing` update returning rows).

TTL lock: 10 minutes; expired lease reusable.

## Taxi financial model (confirmed)

| Item | Source |
|---|---|
| Driver amount | `taxi_commissions.driver_cents` (from `taxi_rides.driver_payout_cents` at complete) |
| Platform commission | `taxi_commissions.platform_cents` |
| Immutable after payout | `refresh_taxi_commissions` refuses overwrite when `driver_paid_out` or `driver_transfer_id` set |
| Stripe method | Transfer + `source_transaction` (not destination charge) |
| Idempotency | `taxi_driver_payout:{rideId}` |
| Refund before payout | blocked (`refund_status`) |
| Refund after payout | admin refund refused; no clawback automation |
| Dispute | eligibility gate present; webhook dispute writer still weak |

Cron may run live in production; with zero eligible drivers returns `ok:true`, `no_eligible_drivers`, `transfers_created:0`. Safety is eligibility gates, not only DRY_RUN.

## Marketplace

**INVENTORY_ONLY** — blockers documented on cron response (`MARKETPLACE_PAYOUT_BLOCKERS`). No live Stripe transfers.

## Observability

All new/updated money/expire crons emit: `ok`, `job`, `run_id`, `dry_run`, `started_at`, `finished_at`, `duration_ms`, `scanned`, `eligible`, `processed`, `skipped`, `failed`, `lock_acquired`, truncated `errors`. Never logs secrets.
