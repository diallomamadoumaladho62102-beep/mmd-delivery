# Cron timeout diagnosis notes

## Vercel max duration (confirmed)

- Same project `mmd-delivery` already uses `export const maxDuration = 60` on `/api/ai/chat`.
- Cron routes now set literal `maxDuration = 60` (Next rejects non-literal imports).
- Production deploy region observed: **iad1**.
- Internal job budget: **45_000 ms** (`CRON_JOB_BUDGET_MS`) so responses can return before soft kill.

## Timeouts

| Call | Timeout |
|---|---|
| Lock acquire/release | 3_000 ms (dedicated timed fetch) |
| Supabase (global fetch) | 8_000 ms |
| Stripe retrieve | 10_000 ms |
| Job budget | 45_000 ms |
| Vercel maxDuration | 60 s |

## Live evidence (2026-07-14, deploy `1db95de`)

Phase traces from `https://www.mmddelivery.com`:

1. Auth is instant (`auth_validated` ≈ 0–2 ms).
2. First Supabase call never completes within bound:
   - lock jobs → `lock_timeout` / busy phase at **≈3000 ms**
   - `taxi-monitoring-snapshot` → `supabase_query_started` then `CronTimeoutError: fetch_aborted_after_8000ms`
3. Same host: DNS resolves; `/auth/v1/health` answers quickly (401 without key). REST `/rest/v1/` / `cron_job_locks` abort at 5–12s.
4. Therefore the timeout is **not** batch size, Stripe, or business SQL volume for the current failures.

### Last phase before failure

| Job | Last productive phase | Failure |
|---|---|---|
| infra-probe | `lock_attempt_started` | lock/RPC hang → 3s |
| expire / taxi / marketplace | `lock_attempt_started` | lock/RPC hang → 3s |
| taxi-monitoring-snapshot | `supabase_query_started` | fetch abort → 8s |

## Conclusion

`CRONS_INFRASTRUCTURE_BLOCKED` — PostgREST/REST path hang after auth succeeds (Vercel and local).

## SQL shapes (read-only)

Expire orders select:

```sql
select id, status, payment_status, expires_at, stripe_session_id, stripe_payment_intent_id
from public.orders
where payment_status in ('unpaid','processing')
  and expires_at is not null
  and expires_at < :cutoff
limit :batch;
```

Same pattern on `delivery_requests`. Batch default now **1**.

`EXPLAIN ANALYZE` deferred until REST connectivity is restored.

## Probe

`POST /api/cron/infra-probe` — auth → lock → `cron_job_locks select limit 1` → optional Stripe balance.

`?skip_lock=1` isolates Supabase/Stripe without the lock RPC.
