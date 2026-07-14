# Supabase Advisor Final Audit — mmd_delivery

**Project:** `mmd_delivery` (`sjmszohmhudayxawfows`)  
**Date:** 2026-07-14  
**Scope:** Dashboard/CLI Advisor triage, RLS and SECURITY DEFINER hardening, post-apply validation  
**Secrets:** None in this document (no passwords, tokens, or key values).

---

## 1. Initial state

### Dashboard (Security-focused view)

| Level | Count | Notes |
|------:|------:|-------|
| Error | **1** | `rls_disabled_in_public` on `public.taxi_preference_stats` |
| Warnings | **537** | SECURITY category only in the Dashboard Security pane |
| Suggestions | **7** | Mapped to INFO `rls_enabled_no_policy` (exactly seven tables) |

### CLI (`npx supabase db advisors --linked --type all --level info`)

Captured under `%TEMP%\mmd-advisor\` (`summary.json` / `categorized.json`):

| Level | Count |
|------:|------:|
| ERROR | 1 |
| WARN | 1173 |
| INFO | 328 |
| **Total** | **1502** |

WARN split by category:

| Category | Count |
|----------|------:|
| SECURITY | **537** (matches Dashboard Warnings) |
| PERFORMANCE | **636** (CLI-only volume; not all shown as Dashboard “Warnings”) |

Dashboard “Suggestions” = the seven INFO `rls_enabled_no_policy` rows. Other INFO (unused indexes, unindexed FKs, etc.) inflate the CLI INFO total beyond seven.

### SECURITY WARN breakdown (before)

| Lint name | Before (WARN) |
|-----------|--------------:|
| `anon_security_definer_function_executable` | 248 |
| `authenticated_security_definer_function_executable` | 248 |
| `function_search_path_mutable` | 37 |
| `extension_in_public` | 2 |
| `public_bucket_allows_listing` | 1 |
| `auth_leaked_password_protection` | 1 |
| **Sum** | **537** |

Additionally (ERROR / INFO, not part of the 537):

| Lint name | Level | Count |
|-----------|-------|------:|
| `rls_disabled_in_public` | ERROR | 1 |
| `rls_enabled_no_policy` | INFO | 7 |

---

## 2. Error: RLS disabled on `taxi_preference_stats`

### Cause

Advisor lint `rls_disabled_in_public` / ERROR: `public.taxi_preference_stats` lived in the exposed `public` schema **without** row level security. With RLS off, any role that can `SELECT`/`WRITE` the table is not filtered by policies. The table held taxi preference aggregates (date / geo dimensions); it had **zero** policies and `relrowsecurity = false` prior to fix.

### Fix

Migration `20260806120000_advisor_security_hardening.sql`:

1. `ALTER TABLE public.taxi_preference_stats ENABLE ROW LEVEL SECURITY;`
2. Staff-only policies via `public.is_staff_user(auth.uid())`:
   - `taxi_preference_stats_staff_select` — `SELECT` for `authenticated`
   - `taxi_preference_stats_staff_write` — `ALL` for `authenticated` (staff)
3. Hot-path index in `20260806120100_advisor_hot_path_indexes.sql`:  
   `taxi_preference_stats_date_geo_idx` on `(stat_date, country_code, city)`.

`service_role` continues to bypass RLS for backend writers.

### Validation

- Privilege / RLS probe (`scripts/sql/advisor_rls_permission_checks.sql` + linked query):  
  `taxi_preference_stats` → `rls_enabled = true`, `policy_count = 2`.
- Linked privilege check row: `public_tables_rls_disabled = 0`.
- Post-apply security advisors: **ERROR count = 0** (`rls_disabled_in_public` absent).

---

## 3. SECURITY warning categories — before / after

Captured after `supabase db push` of both advisor migrations (`sec-after.json`, type security):

| Lint name | Before WARN | After WARN | Disposition |
|-----------|------------:|-----------:|-------------|
| `anon_security_definer_function_executable` | 248 | **0** | **Corrected** — revoked `anon` / `PUBLIC` EXECUTE on SECDEF functions; grant `service_role` (+ selective `authenticated`) |
| `function_search_path_mutable` | 37 | **0** | **Corrected** — `ALTER FUNCTION … SET search_path TO public` for public non-extension functions missing it |
| `authenticated_security_definer_function_executable` | 248 | **233** | **Mostly justified** — trigger-like names stripped from `authenticated`; intentional RPC SECDEF remains executable by signed-in users |
| `extension_in_public` | 2 | 2 | **Left justified** — `pg_trgm`, `pg_net` in `public` (platform / app dependencies) |
| `public_bucket_allows_listing` | 1 | 1 | **Left justified** — storage bucket `restaurant-menu` public listing intentional for menus unless a leak is proven |
| `auth_leaked_password_protection` | 1 | 1 | **Manual** — enable in Supabase Dashboard Auth settings (no Management API token in this session) |
| **SECURITY WARN total** | **537** | **237** | Net −300 |
| **SECURITY ERROR total** | **1** | **0** | Fixed |

Net SECURITY WARN reduction is dominated by clearing **anon** SECDEF executability and freezing **search_path**. Remaining authenticated SECDEF WARN noise is expected for the platform’s RPC surface.

---

## 4. Groups corrected vs left justified

### Corrected in migrations

| Group | Action |
|-------|--------|
| ERROR RLS off | Enabled RLS + staff policies on `taxi_preference_stats` |
| INFO no-policy tables (7) | Added least-privilege policies (see §5) |
| Mutable `search_path` on public functions | Frozen to `public` |
| Anon / PUBLIC EXECUTE on SECDEF | Revoked; `service_role` kept; authenticated revoked for trigger-like prefixes (`trigger_`, `trg_`, `notify_`, `award_`, `expire_`, `auto_`, `retry_`, `guard_`, `touch_`, `set_%updated_at%`, etc.) |
| Hot-path indexes | Additive indexes on reward / shared-ride / webhook / preference-stats filters |

### Left justified / deferred

| Group | Rationale |
|-------|-----------|
| **Authenticated SECDEF RPCs** (~233 WARNs) | Expected for intentional PostgREST RPCs used by the apps; stripping would break clients. Trigger-like internals already locked down. |
| **`auth_rls_initplan` (PERF)** | Deferred — policy rewrite to `(select auth.uid())` style; high volume (~386 after), low urgency relative to ERROR/anon SECDEF. |
| **`multiple_permissive_policies` (PERF)** | Deferred — consolidate overlapping permissive policies carefully; after count ~245. |
| **`unused_index` / other INFO** | Deferred hygiene; do not drop blindly without query proof. |
| **`extension_in_public`** | `pg_trgm` (search/similarity) and `pg_net` (HTTP from DB / hooks) remain in `public`; relocating is disruptive and not required for ERROR closure. |
| **`public_bucket_allows_listing` (`restaurant-menu`)** | Intentional public menu asset listing for restaurant UX; revisit only if private objects are found in that bucket. |
| **`auth_leaked_password_protection`** | Dashboard / Auth configuration — **MANUAL** enable (Have I Been Pwned integration). |
| **`duplicate_index` (PERF)** | Deferred cleanup (~23). |

---

## 5. Seven suggestions resolved via policies

INFO `rls_enabled_no_policy` (Dashboard Suggestions) — tables and post-fix policy counts:

| Table | Policies after | Access model |
|-------|---------------:|--------------|
| `commission_settings` | 1 | Staff `SELECT`; writes via `service_role` |
| `driver_reward_accounts` | 2 | Owner or staff `SELECT`; staff write |
| `driver_reward_history` | 2 | Owner or staff `SELECT`; staff write |
| `notification_logs` | 1 | Staff `SELECT` only |
| `payment_webhook_events` | 1 | Staff `SELECT` only |
| `taxi_business_ride_policies` | 2 | Business members + staff `SELECT`; staff write |
| `taxi_shared_ride_matches` | 2 | Staff or ride participants `SELECT`; staff write |

Plus ERROR table `taxi_preference_stats` (2 policies) in the same migration.

Advisor after snapshot no longer lists `rls_enabled_no_policy` at ERROR/WARN; the seven INFO suggestions are closed by policy presence.

---

## 6. Migrations applied on `mmd_delivery`

Pushed with `npx supabase db push --linked`:

1. **`20260806120000_advisor_security_hardening.sql`**  
   - Enable RLS + policies (`taxi_preference_stats` + 7 suggestion tables)  
   - Freeze `search_path` on eligible public functions  
   - Revoke anon/PUBLIC on SECDEF; grant `service_role`; selective authenticated ACL  

2. **`20260806120100_advisor_hot_path_indexes.sql`**  
   - `taxi_preference_stats_date_geo_idx`  
   - `driver_reward_history_driver_created_idx`  
   - `taxi_shared_ride_matches_shared_ride_idx`  
   - `taxi_shared_ride_matches_candidate_ride_idx` (partial)  
   - `payment_webhook_events_received_idx`  

Apply log: both migrations finished successfully (initial `DROP POLICY IF EXISTS` notices expected on first create).

---

## 7. RLS / grants / index changes (summary)

| Area | Change |
|------|--------|
| RLS | Enabled on `taxi_preference_stats`; policies on eight tables total in hardening migration |
| Grants | SECDEF: revoke from `PUBLIC` + `anon`; grant `EXECUTE` to `service_role`; `authenticated` kept only for non-trigger-like SECDEF |
| Indexes | Five additive indexes (see §6) — non-concurrent, safe for small/near-empty tables inside a transaction |

No financial ledger / payment amount mutations in these migrations.

---

## 8. Tests

### `scripts/sql/advisor_rls_permission_checks.sql`

Read-only linked query asserting RLS flags and policy counts for the eight hardened tables. Observed:

| relname | rls_enabled | policy_count |
|---------|:-----------:|-------------:|
| commission_settings | true | 1 |
| driver_reward_accounts | true | 2 |
| driver_reward_history | true | 2 |
| notification_logs | true | 1 |
| payment_webhook_events | true | 1 |
| taxi_business_ride_policies | true | 2 |
| taxi_preference_stats | true | 2 |
| taxi_shared_ride_matches | true | 2 |

### Privilege queries (linked)

Post-apply probe (boolean HAS privileges; no secret material):

| Check | Result |
|-------|--------|
| `anon` EXECUTE `driver_accept_ready_order` | **false** |
| `authenticated` EXECUTE `driver_accept_ready_order` | **true** |
| `anon` EXECUTE `award_driver_rewards_on_delivery` | **false** |
| `authenticated` EXECUTE `award_driver_rewards_on_delivery` | **false** (trigger-like strip) |
| Tables in `public` with RLS disabled | **0** |

---

## 9. Production smoke (post-hardening)

From the validation session (no secrets logged):

| Check | Result |
|-------|--------|
| Infra probe endpoint | HTTP **200** |
| Probe / smoke script | Exit **0** |
| Auth settings endpoint | HTTP **200** |
| Profiles endpoint | HTTP **200** |
| Crons | Treated as **safe** (no destructive cron changes in this hardening pass; existing production cron posture unchanged) |

Auth leaked-password protection: left as **MANUAL** Dashboard toggle (Management API token unavailable).

---

## 10. EAS preflight notes

| Item | Notes |
|------|-------|
| Stub `apps/mobile/eas.json` | **Removed** — invalid stub / `_comment` key previously broke `eas` when cwd or config resolution picked it up |
| Repo-root `eas.json` | Source of truth for production profiles |
| `eas config --platform android --profile production` | Exit **0** (from repo root after stub removal) |
| `eas config --platform ios --profile production` | Exit **0** |
| Production env | Plain-text/sensitive names loaded as expected (`EXPO_PUBLIC_*` for Mapbox, Sentry, Stripe PK, Supabase URL/publishable); no secret values recorded here |

---

## 11. Remaining risks

1. **Authenticated SECDEF surface (~233 WARNs)** — defense relies on function body auth checks + RLS; continue least-privilege review of high-risk RPCs over time.  
2. **Leaked password protection** — still off until enabled manually in Dashboard.  
3. **PERF advisors** — `auth_rls_initplan`, `multiple_permissive_policies`, `duplicate_index` can matter under load; schedule a dedicated pass.  
4. **Public `restaurant-menu` listing** — intentional; audit objects if any non-menu private content appears.  
5. **Extensions in `public`** — accepted operational risk; document owners if schemas are ever reorganized.  
6. **INFO hygiene** — unused indexes / unindexed FKs remain informational clutter, not Security Error blockers.

---

## 12. Artifact index (local, not committed)

Working copies used during the audit lived under `%TEMP%\mmd-advisor\` (before/after advisor JSON, linked SQL outputs, EAS redacted logs). Do not commit that folder.

### Repo deliverables

- `supabase/migrations/20260806120000_advisor_security_hardening.sql`
- `supabase/migrations/20260806120100_advisor_hot_path_indexes.sql`
- `scripts/sql/advisor_rls_permission_checks.sql`
- `docs/production/SUPABASE_ADVISOR_FINAL_AUDIT.md` (this file)
- Deletion of `apps/mobile/eas.json` stub

---

## 13. Verdict

| Goal | Status |
|------|--------|
| Advisor **ERROR** = 0 | **Met** |
| Close high-risk SECURITY WARN (anon SECDEF + mutable search_path + no-policy RLS) | **Met** |
| Document justified remaining noise | **Met** |
| No secrets in docs / commit messaging | **Met** |

