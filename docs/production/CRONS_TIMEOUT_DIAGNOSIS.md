# Cron timeout diagnosis notes

## Vercel max duration (confirmed)

- Same project `mmd-delivery` already uses `export const maxDuration = 60` on `/api/ai/chat`.
- Cron routes now set `maxDuration = 60`.
- Internal job budget: **45_000 ms** (`CRON_JOB_BUDGET_MS`) so responses can return before soft kill.

## Timeouts

| Call | Timeout |
|---|---|
| Lock acquire/release | 3_000 ms |
| Supabase (global fetch) | 8_000 ms |
| Stripe retrieve | 10_000 ms |
| Job budget | 45_000 ms |
| Vercel maxDuration | 60 s |

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

Recommended indexes if EXPLAIN shows seq scan on large tables:
- `(payment_status, expires_at)` partial where unpaid/processing — only add after confirming EXPLAIN on prod.

## Probe

`POST /api/cron/infra-probe` — auth → lock → `cron_job_locks select limit 1` → optional Stripe balance.
