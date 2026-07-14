# Crons reliability PR — audit matrix & deployment notes

Branch: `pr/crons-reliability`  
Scope: scheduled jobs, runner hardening, locks, expire/PI cleanup, taxi payout dry-run, marketplace inventory.  
Out of scope: Taxi product refactor (sections 3–11).

## 1. Cron matrix

| Name | Frequency | Trigger | Endpoint | Auth | Tables touched | Idempotence | Errors | Concurrency | Retry | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| process-payouts (food/errand) | Sun 03:00 UTC | Vercel Cron | `/api/admin/process-payouts` | `CRON_SECRET` Bearer / `x-cron-secret` (+ admin) | `orders`, transfers via `/api/stripe/transfers/run`, `order_commissions` | Stripe transfer keys + `*_paid_out` flags | HTTP + body; runner treats `ok:false` as fail | `cron_job_locks` job `process-payouts` | Vercel only | **Functional** (locked) |
| expire-unpaid (orders local) | Daily 05:00 UTC | Vercel Cron | `/api/orders/expire-unpaid` | `CRON_SECRET` | `orders` | Re-run cancels already-canceled set | 401/500 | lock `expire-unpaid` | Vercel | **Functional** (no Stripe cancel) |
| expire-stale-payments | Daily 05:15 UTC | Vercel Cron | `/api/cron/expire-stale-payments` | `CRON_SECRET` | `orders`, `delivery_requests`; Stripe PI cancel | Safe cancel + already-canceled tolerate | structured summary; partial row errors counted | lock `expire-stale-payments` | Vercel | **New / ready (dry-run via env)** |
| taxi-payouts | Daily 04:30 UTC | Vercel Cron | `/api/cron/taxi-payouts` → `taxi-run` | `CRON_SECRET` | `taxi_commissions`, Stripe Transfer | `taxi_driver_payout:{rideId}` + `driver_paid_out` | per-ride results | lock `taxi-payouts` | Vercel | **New / DRY_RUN default** |
| marketplace-payouts | Daily 04:45 UTC | Vercel Cron | `/api/cron/marketplace-payouts` | `CRON_SECRET` | read ledger only | N/A (no Stripe) | inventory + stub execute | lock `marketplace-payouts` | Vercel | **New / inventory only** |
| taxi-monitoring-snapshot | Daily 06:00 UTC | Vercel Cron | `/api/cron/taxi-monitoring-snapshot` | `CRON_SECRET` | monitoring tables | snapshot replace | route JSON | none (read-heavy) | Vercel | Functional |
| vehicle-eligibility-refresh | Daily 00:05 UTC | Vercel Cron | `/api/cron/vehicle-eligibility-refresh` | `CRON_SECRET` | vehicle eligibility | refresh | route JSON | none | Vercel | Functional |
| retry-order-dispatch | every 3h | GitHub Actions | `/api/cron/retry-order-dispatch` | `CRON_SECRET` | dispatch state | claim/retry | **hardened** `evaluateCronHttpResult` | GH `concurrency` group | GH workflow | Functional |
| retry-taxi-dispatch | every 3h | GitHub Actions | `/api/cron/retry-taxi-dispatch` | `CRON_SECRET` | taxi dispatch | claim/retry | hardened | GH concurrency | GH | Functional |
| retry-delivery-request-dispatch | every 3h | GitHub Actions | `/api/cron/retry-delivery-request-dispatch` | `CRON_SECRET` | DR dispatch | claim/retry | hardened | GH concurrency | GH | Functional |
| taxi-scheduled-dispatch | every 3h | GitHub Actions | `/api/cron/taxi-scheduled-dispatch` | `CRON_SECRET` | scheduled rides | schedule claim | hardened | GH concurrency | GH | Functional |
| taxi-active-ride-compliance | every 3h | GitHub Actions | `/api/cron/taxi-active-ride-compliance` | `CRON_SECRET` | compliance | re-eval | hardened | GH concurrency | GH | Functional |
| ride-safety-recording-retention | scheduled GH | GitHub Actions | `/api/cron/ride-safety-recording-retention` | `CRON_SECRET` | safety recordings | retention delete | hardened | GH concurrency | GH | Functional |
| Push notifications scheduled | — | — | — | — | — | — | — | — | — | **N/A** |
| Edge `process_driver_payouts` | — | must stay unscheduled | Edge Function | service role | driver payout queue | — | — | — | — | **Manual / disabled** (do not schedule) |

### Push cron = N/A

No deferred push queue / `pending_notification` table / scheduled send worker was found. Push is driven by webhooks / state changes / existing dispatch paths. No dedicated push cron added.

## 2. Gaps confirmed (pre-fix → post-fix)

| Gap | Resolution |
|---|---|
| GH runners treated HTTP 200 + `{ok:false}` as success | `scripts/lib/evaluateCronHttpResult.mjs` + tests |
| No named DB lock for money/expire crons | `cron_job_locks` + RPCs + `withCronJobLock` |
| expire-unpaid ignored DR + Stripe PI | new `expire-stale-payments` |
| Taxi batch payout unscheduled | `/api/cron/taxi-payouts` scheduled, **DRY_RUN=true default** |
| Marketplace live Stripe missing | cron inventories only; stub `executeMarketplacePayouts` |
| Push cron unknown | marked N/A |

## 3. Expire / PaymentIntent rules

- Selects `orders` + `delivery_requests` with `payment_status in (unpaid, processing)` and `expires_at < now - 15m`.
- Reloads Stripe PI before cancel; cancels only `requires_payment_method`.
- Never cancels `succeeded`, `processing`, `requires_action|confirmation|capture`.
- Tolerates already-canceled PI; skips local cancel if PI still in-flight/succeeded (late webhook race).
- Batch limit 100; dry-run via `EXPIRE_STALE_PAYMENTS_DRY_RUN=true` or `?dry_run=1`.

## 4. Taxi payout eligibility

Must be: ride `completed`, `payment_status=paid`, not refunded/disputed, `driver_cents > 0`, hold window elapsed (`TAXI_PAYOUT_HOLD_HOURS`, default 24), Connect `charges_enabled && payouts_enabled`, idempotency key `taxi_driver_payout:{rideId}`.

Live money requires `TAXI_PAYOUTS_DRY_RUN=false` **and** explicit validation — default remains dry-run.

## 5. Marketplace eligibility

Ledger tables `marketplace_seller_payouts` / `marketplace_driver_payouts` with statuses `pending|approved|paid|failed|cancelled`, unique per `seller_order_id`. Live Stripe execution **not** enabled (`executeMarketplacePayouts` stub). Cron is inventory + dry by design. Do not invent live transfers in this PR.

## 6. Secrets / env

| Variable | Required for |
|---|---|
| `CRON_SECRET` | All cron endpoints + GH Actions |
| `SUPABASE_SERVICE_ROLE_KEY` / `NEXT_PUBLIC_SUPABASE_URL` | Locks + DB work |
| `STRIPE_SECRET_KEY` | expire-stale PI cancel; taxi-run |
| `TAXI_PAYOUTS_DRY_RUN` | default `true` |
| `TAXI_PAYOUT_HOLD_HOURS` | default `24` |
| `EXPIRE_STALE_PAYMENTS_DRY_RUN` | optional |
| `CRON_FETCH_TIMEOUT_MS` | GH runners (default 60s) |
| `SITE_URL` / `PRODUCTION_SITE_URL` | GH cron invokers |

## 7. Deployment posture

- Migration `20260805120000_cron_job_locks.sql` must be applied before locks work in prod.
- **Do not** set `TAXI_PAYOUTS_DRY_RUN=false` until staging proof.
- Marketplace remains non-live.
- Prefer staging dry-run of expire-stale before clearing `EXPIRE_STALE_PAYMENTS_DRY_RUN`.

## 8. Tests added

- `scripts/evaluateCronHttpResult.test.mjs`
- `apps/web/src/lib/expireStalePayments.test.ts`
- `apps/web/src/lib/taxiPayoutEligibility.test.ts`
- `apps/web/src/lib/cronJobLock.test.ts` (mocked RPC)
- `cronAuth.test.ts` missing-secret production case

Lock RPC behavior against real Postgres is covered by migration + mock; document limit: no live advisory-lock integration in CI without DB.
