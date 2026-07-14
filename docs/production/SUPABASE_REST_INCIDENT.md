# Supabase REST incident — mmd_delivery

**Conclusion:** `SUPABASE_PROJECT_INCIDENT_ESCALATED`  
**UTC window observed:** 2026-07-14 ~01:35–02:15 UTC (local probes continued after)  
**Project:** `mmd_delivery` / ref `sjmszohmhudayxawfows` / region East US (Ohio) / Postgres `17.6.1` / PostgREST `v13.0.5`

## Root cause (most probable)

**Project-scoped DB connectivity degradation** between Supabase API services (PostgREST, Storage metadata, occasionally Auth) and PostgreSQL/pooler — not application cron code, not wrong Vercel URL/JWT project ref, not a proven schema/RLS/pre-request hook.

Smoking gun:

- `GET /storage/v1/bucket` → **HTTP 544** `DatabaseTimeout` — *"The connection to the database timed out"*
- CLI: `unexpected login role status 544: Failed to create login role: Connection terminated due to connection timeout`
- Pooler client: `(EAUTHQUERY) authentication query failed: connection to database not available`
- `GET /rest/v1/...` → **client abort / no HTTP status** after 8s
- Edge-ish paths respond: Auth health without key (401), Functions root (404), TLS OK

Matches known split-brain pattern (DB-coupled fail, non-DB edge OK):  
https://github.com/supabase/supabase/issues/42858

## Endpoint matrix (local)

| Service | Result | HTTP | ms | Notes |
|---|---|---:|---:|---|
| DNS (Node resolve4) | weak | — | ~3 | empty A/AAAA via dns/promises; TCP still connects |
| TCP 443 | OK | — | ~40 | |
| TLS 1.3 | OK | — | ~100–160 | `supabase.co` cert |
| Auth `/auth/v1/health` no key | OK | 401 | ~100–190 | edge, no DB |
| Auth `/auth/v1/health` with key | intermittent | 200 or abort | 2.7s–8s+ | sometimes recovers |
| REST `/rest/v1/` | FAIL | — | ~8000 | abort |
| REST `cron_job_locks?limit=1` | FAIL | — | ~8000 | abort |
| Storage `/storage/v1/bucket` | FAIL | **544** | ~5140 | DatabaseTimeout |
| Functions `/functions/v1/` | OK | 404 | ~150–200 | no function deployed |
| TCP db host :5432/:6543 | OK | — | ~40–90 | port open |
| Pooler TCP | OK | — | ~45–65 | port open |
| Pooler SQL auth | FAIL | — | ~10s | connection not available |
| CLI inspect blocking | intermittent OK | — | — | empty blockers when it connects |
| CLI login-role / db-stats | FAIL | 544 / timeout | — | |

## Origin matrix

| Origine | DNS/TCP | HTTPS/TLS | Auth | REST | DB directe / CLI |
| --- | ---: | ---: | ---: | ---: | ---: |
| Local terminal | TCP OK | OK | intermittent | FAIL | intermittent / 544 |
| Vercel Production | n/a | OK route | OK (cron auth) | FAIL (`supabase_query` ~8s) | n/a |
| GitHub Actions | not re-run this pass | — | — | prior cron dispatch timeouts | — |
| Supabase CLI | OK list project | — | — | — | login-role 544 / occasional inspect |

## Vercel configuration (no secrets)

| Variable | Present (Prod/Preview/Dev) | Host / JWT ref |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes all three | `sjmszohmhudayxawfows.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | JWT `ref=sjmszohmhudayxawfows`, `role=anon` |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | JWT `ref=sjmszohmhudayxawfows`, `role=service_role` |
| `EXPO_PUBLIC_SUPABASE_URL` | not in pulled prod local | — |
| Whitespace / newlines in values | none detected | — |

Keys match the linked project. **Not a wrong-project URL.**

## PostgreSQL / PostgREST app config

- No `pgrst.db_pre_request` / pre-request functions found in repo migrations.
- When CLI connected: no long-running queries, no blocking rows visible.
- `db-stats` / `role-stats` hit statement timeout or login-role 544 — cannot claim connection saturation from live stats this session.
- Pooler URL host: `aws-1-us-east-2.pooler.supabase.com:5432` (CLI temp; password not stored in repo env files).

## Correction applied

**None safe from this environment.** No Management API token available here to restart services. No dashboard pause/reactivate performed. No secrets rotated. No migrations rolled back. No `db reset`.

Recommended operator actions (dashboard / support):

1. Confirm project not paused; check Database / API health widgets.
2. If offered: safe **restart / pause→restore** of project API without data wipe.
3. Ask Supabase to reset pooler / re-place DB host for `sjmszohmhudayxawfows`.
4. After REST returns `<2s`, re-run cron validation (`infra-probe?skip_lock=1`, monitoring, marketplace inventory, taxi, expire dry-run).

## Support message (ready to send)

See bottom of this file / chat response.

## Cron validation after fix

**Blocked** — cannot validate until REST recovers.

## Git

Diagnostic scripts may exist locally (`scripts/diagnose-supabase-infra.mjs`, `scripts/diagnose-supabase-postgres.mjs`). No financial/cron engine change required for this incident.
