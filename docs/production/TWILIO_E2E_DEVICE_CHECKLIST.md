# Twilio masked call — E2E device checklist

## Technical readiness: PASS (code + prod probes)

| Source | Roles supported | Route |
|--------|-----------------|-------|
| **Food** | client, driver, restaurant | `POST /api/twilio/calls/create` + `sourceTable=orders` |
| **Delivery** | client, driver | `sourceTable=delivery_requests` |
| **Taxi** | client, driver | `sourceTable=taxi_rides` |

Automated tests: `npx tsx src/lib/twilioMaskedCallReadiness.test.ts`  
Prod probe without JWT: **401** (PASS).

## Prerequisites (ops)

| Item | Status |
|------|--------|
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` on Vercel | Ops |
| `TWILIO_AUTH_TOKEN` for voice webhook signature | Ops |
| Caller + target profiles have `phone` in Supabase | Data |
| Active paid order / delivery / taxi with assigned driver | Test data |

## Device E2E — PASS / FAIL

Use production app with real JWT (logged-in user).

| # | Scenario | Caller → Target | Call connects (masked) | PASS / FAIL |
|---|----------|-----------------|------------------------|-------------|
| 1 | Food order in progress | driver → client | | |
| 2 | Food order in progress | restaurant → driver | | |
| 3 | Delivery request active | driver → client | | |
| 4 | Taxi ride active | client → driver | | |

**Expected errors (correct behavior):**

- No JWT → 401
- Wrong participant → 403
- Missing phone on profile → 404 with clear message

**Sign-off:** `TWILIO_E2E_MASKED_CALL_DONE=true` in `store-submission.env`.
