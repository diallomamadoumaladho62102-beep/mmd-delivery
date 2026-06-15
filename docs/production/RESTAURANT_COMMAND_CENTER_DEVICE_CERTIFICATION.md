# Restaurant Command Center — Device Production Certification

**Feature:** `RestaurantCommandCenter` (commit `67cd934`+)  
**Production API:** `https://www.mmddelivery.com`  
**Purpose:** Close all P0 items with a real approved restaurant account on a physical device before V1.1 design work.

Store evidence under `docs/production/reports/mobile/restaurant-command-center/` (gitignored parent `reports/`).  
Do **not** commit credentials, JWTs, or customer PII.

---

## Prerequisites

| Item | Required |
|------|----------|
| TestFlight or Android production build | Includes `67cd934` + `95d17c8` or later |
| Approved restaurant account | `profiles.role = restaurant`, `restaurant_profiles.status = approved` |
| Restaurant GPS set | `restaurant_profiles.location_lat/lng` non-null |
| Restaurant online | `is_accepting_orders = true` |
| Mapbox token in mobile build | `EXPO_PUBLIC_MAPBOX_TOKEN` configured |
| Optional: second restaurant account | For data-isolation test |
| Optional: active driver + client | For driver arrived / approaching / live map |

### Pre-flight (terminal — founder machine)

1. Copy `docs/production/final-certification.env.example` → `docs/production/final-certification.env` (never commit).
2. Set:
   - `CERTIFICATION_RESTAURANT_EMAIL` + `CERTIFICATION_RESTAURANT_PASSWORD`  
     **or** `CERTIFICATION_RESTAURANT_ACCESS_TOKEN`
   - `CERTIFICATION_RESTAURANT_USER_ID` (UUID of test restaurant)
   - `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (production)
3. Run:
   ```bash
   node apps/web/scripts/restaurant-command-center-production-validation.mjs
   ```
4. Confirm report at `docs/production/reports/restaurant-command-center-validation.json`:
   - Both API routes **PASS**
   - Authenticated probes **PASS** (not SKIP)
   - `restaurant.userId` matches `CERTIFICATION_RESTAURANT_USER_ID`

---

## How to open Command Center on device

1. Log in as **restaurant** role.
2. **Restaurant Home** → floating **👑 Dashboard** button.
3. Screen route: `RestaurantCommandCenter`.

---

## Device test matrix

**Tester:** ___________________  
**Date (UTC):** ___________________  
**Build:** iOS TestFlight _____ / Android _____ (version ______)  
**Restaurant name:** ___________________  
**Restaurant user_id:** ___________________  
**Market / currency:** ___________________

Mark each row: **PASS** | **FAIL** | **SKIP** (with reason)

| ID | Area | Steps | Expected result | Evidence | Result | Notes |
|----|------|-------|-----------------|----------|--------|-------|
| R-01 | **Restaurant login** | Sign out → sign in with certification restaurant email/password | Lands on Restaurant Home; no auth errors | Screenshot login + home | | |
| R-02 | **Command Center loads** | Tap 👑 Dashboard | KPI row + sections load; no infinite spinner | Screenshot full screen | | |
| R-03 | **Revenue Today** | Compare KPI to Supabase: sum of **delivered/completed** food orders today for this `restaurant_id` | Matches within rounding; currency = restaurant currency | Screenshot + SQL note | | |
| R-04 | **Orders Today** | Count food orders created today (`payment_status=paid`) | Matches KPI `ordersToday` | Screenshot + count | | |
| R-05 | **Customers Today** | Count distinct `client_id` on today's orders | Matches KPI `customersToday` | Screenshot + count | | |
| R-06 | **Top Products** | Scroll to Top Products | Lists real items from recent sales; qty/revenue non-zero if sales exist | Screenshot | | |
| R-07 | **Financial Summary** | Scroll to Financial Summary | Month gross / commission / net shown; currency formatted | Screenshot | | |
| R-08 | **Driver Arrived** | With driver assigned & GPS within ~50 m of restaurant | Green “Driver arrived” card; **Hand over order** visible | Screenshot + timestamp | | SKIP if no live driver |
| R-09 | **Driver Approaching** | Driver en route, ETA ≤ 5 min, > 50 m away | Orange approaching card with ETA | Screenshot | | SKIP if no live driver |
| R-10 | **Live Map** | Scroll to map section | Map renders (not fallback message); restaurant pin + drivers if active | Screenshot / short video | | |
| R-11 | **Realtime updates** | Keep Command Center open; trigger new paid food order (client) | New order card appears **without** manual refresh | Screen recording | | |
| R-12 | **Accept Order** | Tap **Accept** on pending order card | Order status → accepted; card disappears or updates | Screenshot + order id | | |
| R-13 | **Reject Order** | Tap **Reject** → confirm | Order canceled; removed from live ops | Screenshot + order id | | |
| R-14 | **Hand Over Order** | On arrived card, tap **Hand over order** | Opens `RestaurantOrderDetails`; pickup code visible | Screenshot order details | | |
| R-15 | **View On Map** | On approaching/en-route card, tap **View on map** | Map centers on driver | Screenshot | | |
| R-16 | **Inventory navigation** | AI section → **View inventory** (if stock alert shown) **or** verify menu path | Opens `RestaurantMenu` | Screenshot | | |
| R-17 | **Financial reports** | Tap **View full report** | Opens `RestaurantFinancialCenter` with data | Screenshot | | |
| R-18 | **All Orders** | Tap **View all orders** | Opens `RestaurantOrders` list | Screenshot | | |
| R-19 | **Language — English** | Settings → English → reopen Command Center | All labels English; dates/currency EN format | Screenshot | | |
| R-20 | **Language — French** | Switch to Français → reopen Command Center | All labels French | Screenshot | | |
| R-21 | **Language — Spanish** | Switch to Español | All labels Spanish | Screenshot | | |
| R-22 | **Language — Chinese** | Switch to 中文 | All labels Chinese | Screenshot | | |
| R-23 | **Language — Fulah** | Switch to Pulaar/Fulfulde | Labels use FF keys (no English fallbacks visible) | Screenshot | | |
| R-24 | **Arabic + RTL** | Switch to العربية | RTL layout; Arabic strings; no clipped/overlapping text | Screenshot | | |
| R-25 | **Data isolation** | Log in as Restaurant A → note order ids/counts → log in as Restaurant B | B never shows A's orders, revenue, or drivers | Screenshots A vs B | | Needs 2 accounts |

### SQL helpers (Supabase SQL Editor — read only)

**Revenue today (restaurant):**
```sql
select coalesce(sum(total), 0) as revenue_today
from orders
where kind = 'food'
  and restaurant_id = '<RESTAURANT_USER_ID>'
  and payment_status = 'paid'
  and status in ('delivered', 'completed')
  and created_at >= date_trunc('day', now() at time zone 'UTC');
```

**Orders today:**
```sql
select count(*) as orders_today
from orders
where kind = 'food'
  and restaurant_id = '<RESTAURANT_USER_ID>'
  and payment_status = 'paid'
  and created_at >= date_trunc('day', now() at time zone 'UTC');
```

**Customers today:**
```sql
select count(distinct coalesce(client_id, client_user_id)) as customers_today
from orders
where kind = 'food'
  and restaurant_id = '<RESTAURANT_USER_ID>'
  and payment_status = 'paid'
  and created_at >= date_trunc('day', now() at time zone 'UTC');
```

Adjust timezone if restaurant market uses local midnight (document which TZ you used).

---

## P0 blockers (must be PASS for GO)

| P0 | Check ID | Blocker if FAIL |
|----|----------|-----------------|
| Authenticated API validation script | Pre-flight | KPIs unverified server-side |
| R-01 Restaurant login | R-01 | Cannot test tenant-scoped data |
| R-02 Command Center loads | R-02 | Feature unusable |
| R-03 Revenue Today | R-03 | Wrong financial truth |
| R-04 Orders Today | R-04 | Wrong operational truth |
| R-11 Realtime updates | R-11 | Live ops not production-ready |
| R-12 Accept Order | R-12 | Cannot operate restaurant |
| R-13 Reject Order | R-13 | Cannot operate restaurant |
| R-25 Data isolation | R-25 | Security / compliance failure |

Driver/map rows (R-08, R-09, R-10, R-15) are **P0 only when a live delivery is scheduled** during the test window; otherwise mark **SKIP** with reason and schedule a follow-up dispatch test.

---

## GO / NO-GO decision record

Complete after all P0 rows are PASS or documented SKIP with follow-up date.

| Field | Value |
|-------|-------|
| **Certification date** | |
| **Tester / role** | |
| **Build tested** | |
| **API script verdict** | PASS / FAIL / PARTIAL |
| **Device tests PASS count** | ___ / 25 |
| **Device tests FAIL count** | |
| **Open P0 failures** | |

### Decision

- [ ] **GO** — Restaurant Command Center certified for production use. V1.1 Ultra Premium Design may start.
- [ ] **NO-GO** — Blockers listed below must be resolved and this checklist re-run.

**Blockers (if NO-GO):**

1.  
2.  
3.  

**Sign-off:** ___________________  **Date:** ___________________

---

## Related docs

- `docs/production/MOBILE_DEVICE_CERTIFICATION_CHECKLIST.md` — platform-wide mobile sign-off
- `docs/production/FINAL_PRODUCTION_CERTIFICATION_RUNBOOK.md` — global production certification
- `apps/web/scripts/restaurant-command-center-production-validation.mjs` — automated API validation
