# Post-Micro infrastructure validation

| Field | Value |
|---|---|
| **Validation date (UTC)** | 2026-07-14 (~03:05–03:15 UTC) |
| **Supabase project** | `mmd_delivery` |
| **Project ref** | `sjmszohmhudayxawfows` |
| **Region** | East US / Ohio (`us-east-2`) |
| **Plan / compute** | Pro + **Compute Micro** (migration completed) |
| **CLI project status** | `ACTIVE_HEALTHY` |
| **Final conclusion** | `SUPABASE_REST_RECOVERED_CRONS_PRODUCTION_READY` |

## Incident summary

Before the Pro / Micro upgrade, the project hit infrastructure exhaustion that blocked all DB-coupled APIs used by production crons.

Primary error observed:

- Storage: HTTP **544** `DatabaseTimeout` — *The connection to the database timed out*
- PostgREST `/rest/v1/`: client abort (~8 s) or, during early recovery, **503** `PGRST002` (*Could not query the database for the schema cache*)
- Auth with API key: intermittent multi-second latency or abort
- Vercel crons: authenticated successfully, then failed on the first Supabase call (`supabase_timeout` / lock acquire timeout)
- Dashboard-style signal during the outage window: *project exhausting multiple resources* (treated as **historical** after Micro)

Root cause class: **project compute / DB-path capacity**, not wrong Vercel URL/JWT project ref, and not application cron batch size.

## Symptoms before migration

| Check | Result |
|---|---|
| Auth `/auth/v1/health` with key | Intermittent abort or multi-second latency |
| REST simple `select` (`limit=1`) | Fail — abort ≥ ~8 s |
| Storage `/storage/v1/bucket` | Fail — **544 DatabaseTimeout** (~5 s) |
| `infra-probe` / monitoring / payouts / expire | Fail after auth — Supabase hang or lock timeout (~3–8 s) |
| Stripe transfers during diagnosis | None executed |

## Results after migration (Compute Micro)

Warm-up note: in the first minutes after upgrade, REST briefly returned `PGRST002` and one lock select answered in ~18 s while the PostgREST schema cache loaded. After warm-up, all checks below were stable.

| Check | HTTP | Observed latency |
|---|---:|---:|
| Auth `/auth/v1/health` with key | 200 | ~145–176 ms |
| REST `cron_job_locks?select=job_name&limit=1` | 200 | ~62 ms (warm) |
| REST `orders?select=id&limit=1` | 200 | ~191 ms |
| Storage `/storage/v1/bucket` | 200 | ~301–837 ms (settled; first post-upgrade probe ~5 s then normal) |
| 544 `DatabaseTimeout` | — | **Absent** on successful probes |

Application lock leases left by earlier timed-out cron runs (`infra-probe`, `payment-expiration`) were cleared so validation was not blocked by stale leases. No Supabase project configuration, secrets, or migrations were changed during this validation pass.

## Cron validation results (production site)

All runs below are **safe modes only** (dry-run and/or inventory-only). **No real Stripe transfer** and **no live payment expiration** were executed.

| Cron | Mode | Result | Client duration | Highlights |
|---|---|---|---:|---|
| `infra-probe?skip_lock=1` | probe | **ok** | 382 ms | Supabase query ~130 ms; `supabase_ok` |
| `infra-probe` | probe + lock | **ok** | 360 ms | Lock acquire ~72 ms; `lock_acquired: true` |
| `taxi-monitoring-snapshot` | live RPC (monitoring) | **ok** | 266 ms | Query ~154 ms |
| `expire-stale-payments` | dry-run, batch 1 | **ok** | 290 ms | scanned/eligible = 2; `partial: false` |
| `expire-stale-payments` | dry-run, batch 5 | **ok** | 247 ms | scanned/eligible = 2 |
| `expire-stale-payments` | dry-run, batch 10 | **ok** | 262 ms | scanned/eligible = 2 |
| `marketplace-payouts` | `INVENTORY_ONLY` | **ok** | 265 ms | `transfers_created: 0` |
| `taxi-payouts` | dry-run, batch 1 | **ok** | 262 ms | `no_eligible_drivers: true`; `transfers_created: 0` |
| `taxi-payouts` | dry-run, batch 5 | **ok** | 172 ms | same; `transfers_created: 0` |

### Stripe / money movement confirmation

- **Real Stripe transfers:** none  
- **Live taxi payouts:** none (dry-run only)  
- **Live marketplace payouts:** none (`INVENTORY_ONLY`)  
- **Live `expire-stale-payments` cancel/expire:** not executed (dry-run only)

## Timing comparison (before → after warm)

| Path | Before Micro | After Micro (warm) |
|---|---:|---:|
| Storage bucket list | fail 544 ~5 s | success ~0.3–0.8 s |
| REST simple select | fail ≥8 s | success ~0.06–0.2 s |
| Vercel `infra-probe` | fail ~8 s | success ~0.13–0.24 s (phase elapsed) |
| Vercel expire dry-run | fail / lock timeout ~3 s | success ~0.2–0.3 s |
| Vercel taxi dry-run | fail ~3 s | success ~0.1–0.3 s |

## Remaining limits (non-blocking for this closure)

1. Marketplace payouts remain **`INVENTORY_ONLY`** until a separate live-payout certification.  
2. Taxi payouts were validated in **dry-run** with `no_eligible_drivers`; enable live transfers only after eligible real Connect drivers exist and a dedicated go-live checklist.  
3. Live `expire-stale-payments` (non–dry-run) was intentionally not run in this pass.  
4. Brief PostgREST cold/schema-cache warm-up can still occur after major compute changes; cron timeouts (explicit 8 s / lock 3 s) remain useful safety rails.  
5. Dashboard banners like *project exhausting multiple resources* should be treated as **historical** unless CPU/RAM/connection graphs still spike under Micro.

## Safety / secrets

This document contains **no** Stripe keys, Supabase service/anon keys, JWTs, cron secrets, connection strings, or other credentials.

## Final conclusion

**`SUPABASE_REST_RECOVERED_CRONS_PRODUCTION_READY`**

Infrastructure incident closed. Production cron paths are executable again under the validated safe modes above.
