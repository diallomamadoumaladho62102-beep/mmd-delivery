# Final production certification runbook

Transform operational **hypotheses** into **PASS/FAIL proofs** before public launch.  
All steps are **read-only** unless explicitly marked.

**Related files**

| File | Purpose |
|------|---------|
| `docs/production/sql/final_certification_checks.sql` | Supabase SQL proofs |
| `docs/production/final-certification.env.example` | Env template (copy, never commit secrets) |
| `apps/web/scripts/final-production-certification.mjs` | Automated API/ops checks + JSON report |
| `docs/production/MOBILE_DEVICE_CERTIFICATION_CHECKLIST.md` | Device sign-off |
| `docs/production/RESTAURANT_COMMAND_CENTER_DEVICE_CERTIFICATION.md` | Restaurant Command Center device + GO/NO-GO |
| `apps/web/scripts/restaurant-command-center-production-validation.mjs` | Restaurant Command Center API validation |

---

## Quick start (founder)

```powershell
# 1) Copy env template (do NOT commit the filled file)
copy docs\production\final-certification.env.example docs\production\final-certification.env

# 2) Edit docs\production\final-certification.env with your prod values

# 3) Run Supabase SQL (Dashboard → SQL Editor)
#    Paste and run: docs/production/sql/final_certification_checks.sql

# 4) Run Node certification (from repo root)
node apps/web/scripts/final-production-certification.mjs --env docs/production/final-certification.env

# 5) Review report
type docs\production\reports\final-certification-report.json
```

**Exit code:** `0` = no FAIL checks; `1` = at least one FAIL.

---

## Interpreting PASS / FAIL / SKIP / MANUAL

| Status | Meaning |
|--------|---------|
| **PASS** | Proof succeeded with evidence in report or SQL output |
| **FAIL** | Proof failed — blocks `READY FOR REAL PUBLIC PRODUCTION` |
| **SKIP** | Not run (missing env). Complete setup and re-run |
| **MANUAL** | Requires human dashboard/device sign-off; set env flag to `true` after done |

**Verdict rule (script):** `READY` only when **zero FAIL** and **zero MANUAL** pending.

---

## Step 1 — Supabase production

### 1.1 Apply migrations (if not already)

Confirm in Supabase Dashboard → Database → Migrations:

- `20260716120000_food_order_trust_boundary`
- `20260717120000_production_hardening_p0_p1`

If missing: `supabase db push` from a trusted machine (outside this runbook scope).

### 1.2 Run certification SQL

1. Open **Supabase Dashboard → SQL Editor → Production**
2. Paste `docs/production/sql/final_certification_checks.sql`
3. Run each section; compare to **EXPECTED** comments

| Section | PASS when |
|---------|-----------|
| Migrations | 3 rows (`20260716120000`, `20260717120000`, `20260720120000`) |
| RLS enabled | `orders`, `delivery_requests`, `taxi_rides` → `rls_enabled = true` |
| Forbidden INSERT policies | 0 rows for client insert policy names |
| Triggers | Both `trg_guard_*` triggers present |
| `stripe_webhook_events` | SELECT succeeds |
| AI tables | `ai_runtime_settings` ≥ 1 row; queries succeed |
| `platform_countries` | count = **11** |

### 1.2a Supabase trust-boundary — VALIDATED (production)

**Date :** 2026-06-15 · **Statut : PASS**

| Preuve SQL | Résultat production |
|------------|---------------------|
| Migrations | `20260716120000` food_order_trust_boundary · `20260717120000` production_hardening_p0_p1 |
| RLS activée | `orders`, `delivery_requests`, `taxi_rides` → `true` |
| Policies INSERT client | 0 ligne (forbidden policy names absentes) |
| Triggers financiers | `trg_guard_orders_client_financial_update` = O · `trg_guard_delivery_requests_client_financial_update` = O |

Après validation SQL Editor, activer dans `final-certification.env` :

```
SUPABASE_TRUST_BOUNDARY_SQL_DONE=true
SUPABASE_TRUST_BOUNDARY_SQL_VALIDATED_AT=2026-06-15
```

Re-lancer le script : les checks `trust_boundary_*` et `migrations_sql` passent de **MANUAL** à **PASS**.

**Blockers Supabase retirés** — il ne reste plus que Stripe Dashboard, E2E paiements, mobile, crons externes.

### 1.3 Optional RLS live probe (Node)

In `final-certification.env`:

```
CERTIFICATION_ALLOW_RLS_PROBE=true
TEST_CLIENT_JWT=<access_token>
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
```

Re-run script. Expect **PASS** on `rls_block_*_insert` with permission/RLS errors.

---

## Step 2 — Stripe Dashboard

Manual review (cannot be automated without Stripe API key in this runbook).

### Checklist

1. **Developers → Webhooks (Live mode)**
   - Exactly **one** endpoint
   - URL: `https://www.mmddelivery.com/api/stripe/webhook`
   - Events include: `checkout.session.completed`, `payment_intent.succeeded`

2. **No duplicate handler**
   - No Supabase project URL in webhook list

3. **Recent deliveries**
   - After a test payment: one delivery per `event.id`

4. Set in env after review:

```
STRIPE_DASHBOARD_CHECK_DONE=true
STRIPE_UNIQUE_WEBHOOK_CONFIRMED=true
```

### Edge webhook disable

**Option A — Supabase Dashboard**

Functions → `stripe_webhook` → Secrets:

```
MMD_STRIPE_WEBHOOK_DISABLED=true
```

**Option B — Script auto-probe**

Set `SUPABASE_URL` in env. Script POSTs to  
`{SUPABASE_URL}/functions/v1/stripe_webhook`  
Expect: `{ disabled: true }` or HTTP **410** `edge_webhook_disabled`.

Then set:

```
EDGE_WEBHOOK_DISABLED_CONFIRMED=true
```

---

## Step 3 — Vercel production

### 3.1 Deploy SHA

Dashboard → Project → Deployments → Production → copy **Git commit SHA**.  
Must match `origin/main` after hardening (`08c7ddf` or later).

### 3.2 Health (automated)

Script checks:

- `GET /api/health` → `ok: true`, `platform_countries.count: 11`
- `GET /api/health/stripe-webhook` → canonical URL
- `GET /api/ai/health` → `ok: true`

### 3.3 Env vars (manual confirm in Vercel)

| Variable | Required |
|----------|----------|
| `SUPABASE_SERVICE_ROLE_KEY` | Production |
| `STRIPE_SECRET_KEY` | `sk_live_*` |
| `STRIPE_WEBHOOK_SECRET` | Live webhook signing secret |
| `CRON_SECRET` | Matches external cron |
| `DISPATCH_INTERNAL_SECRET` | Dispatch internal calls |

---

## Step 4 — Cron & monitoring

### Vercel-native crons (`apps/web/vercel.json`)

| Schedule (UTC) | Path | Proof |
|----------------|------|-------|
| Sun 03:00 | `/api/admin/process-payouts` | Vercel → Cron Jobs → last run log |
| Daily 05:00 | `/api/orders/expire-unpaid` | Same |
| Daily 06:00 | `/api/cron/taxi-monitoring-snapshot` | Same |

**Do not** call `process-payouts` from the script unless `CERTIFICATION_ALLOW_PAYOUT_CRON=true` (real money).

### External crons (required on Hobby)

Configure at **cron-job.org** or GitHub Actions — every **2–5 min**:

| Path | Header |
|------|--------|
| `/api/cron/retry-order-dispatch` | `Authorization: Bearer $CRON_SECRET` |
| `/api/cron/retry-taxi-dispatch` | same |
| `/api/cron/taxi-scheduled-dispatch` | same |

Optional: `/api/monitoring` with `CRON_SECRET` or `MONITORING_SECRET`.

### Script proof

Set `CRON_SECRET` in env. Script expects:

- **401** without secret (PASS `*_protected`)
- **200** with secret on dispatch/monitoring routes (PASS `*_execution`)

Save cron provider screenshot + JSON report body as evidence.

---

## Step 5 — Payment API probes (no Live charge by default)

Set in `final-certification.env`:

```
TEST_CLIENT_JWT=<Supabase access_token for test client>
CERTIFICATION_SCOPE_COUNTRY=US
CERTIFICATION_RESTAURANT_USER_ID=<approved restaurant user_id>
CERTIFICATION_MENU_ITEM_ID=<real menu item uuid>
```

Optional unpaid row creation (still **no Stripe**):

```
CERTIFICATION_ALLOW_CREATE=true
```

| Endpoint | PASS when |
|----------|-----------|
| `POST /api/orders/food/quote` | `ok: true`, server `total` + `currency` |
| `POST /api/orders/food/create` | `ok: true`, order id (if ALLOW_CREATE) |
| `POST /api/delivery-requests/quote` | `ok: true` |
| `POST /api/delivery-requests/create` | `ok: true` (if ALLOW_CREATE) |
| `POST /api/taxi/rides/quote` | quote with `total_cents` |

### Live payment E2E (founder only)

```
CERTIFICATION_ALLOW_LIVE_PAYMENT=true
```

Complete manually: checkout → Stripe → webhook → `payment_status=paid`.  
Verify once in SQL:

```sql
SELECT stripe_event_id, event_type, created_at
FROM public.stripe_webhook_events
ORDER BY created_at DESC LIMIT 3;
```

---

## Step 6 — TestFlight (iOS)

1. Install latest **TestFlight** build from EAS production profile
2. Complete `MOBILE_DEVICE_CERTIFICATION_CHECKLIST.md` for **US** and **GN**
3. Attach screenshots to `docs/production/reports/mobile/`
4. Set:

```
TESTFLIGHT_US_CHECK_DONE=true
TESTFLIGHT_GN_CHECK_DONE=true
```

---

## Step 7 — Android production

1. Install from Play track configured in `eas.json` (`internal` or production)
2. Complete Android sections of mobile checklist (US + GN)
3. Set:

```
ANDROID_US_CHECK_DONE=true
ANDROID_GN_CHECK_DONE=true
```

---

## Final sign-off

Re-run:

```powershell
node apps/web/scripts/final-production-certification.mjs --env docs/production/final-certification.env
```

| Verdict | Action |
|---------|--------|
| `READY FOR REAL PUBLIC PRODUCTION` | All proofs collected; proceed to launch |
| `NOT READY FOR REAL PUBLIC PRODUCTION` | Fix every FAIL; complete every MANUAL item |

### Remaining real blockers (after Supabase SQL validated)

1. **Stripe Dashboard** — exactly one Live webhook → `https://www.mmddelivery.com/api/stripe/webhook`
2. **E2E Live payments** — food, delivery, taxi (quote → checkout → webhook → paid)
3. **TestFlight / Android** — US + GN device checklist signed
4. **External dispatch crons** — retry-order-dispatch, retry-taxi-dispatch, taxi-scheduled-dispatch

Supabase trust-boundary (migrations, RLS, INSERT policies, financial triggers) is **no longer a blocker** once `SUPABASE_TRUST_BOUNDARY_SQL_DONE=true`.

Archive for compliance:

- `final-certification-report.json`
- SQL Editor export / screenshots
- Stripe webhook screenshot
- Cron execution log
- Mobile checklist signed PDF or folder

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| `webhook_events count_failed` in health | RLS/permissions on `stripe_webhook_events` or missing table |
| Food quote 403 `restaurant_unavailable` | Launch control / scope — set `country=US&lat/lng` query params |
| Cron 401 with secret | Wrong `CRON_SECRET` in env vs Vercel |
| Edge probe not disabled | Missing `MMD_STRIPE_WEBHOOK_DISABLED=true` on Edge function |
| RLS probe INSERT succeeds | Migration `20260716/17` not applied |

See also: `docs/production/EXTERNAL_OPS_MANUAL.md`, `docs/production/DISPATCH_CRON_STRATEGY.md`.
