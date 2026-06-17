# B6 — Store Submission device smoke (sign-off before store upload)

**When:** after first EAS production build, **before** Play/App Store upload.  
**Not required** to authorize `eas build --profile production`.  
**Evidence:** `docs/production/reports/mobile/b6/` (gitignored parent).

Automated pre-check (run first):

```powershell
node apps/web/scripts/store-submission-readiness.mjs
npx tsx apps/web/src/lib/deepLinkWellKnown.test.ts
```

---

## Automated vs device

| Check | Automated | Device required |
|-------|-----------|-----------------|
| AASA / assetlinks live | Yes | — |
| Proxy restaurant web | Yes | — |
| Edge push auth | Yes | — |
| Twilio route protected | Yes | — |
| EAS secrets list | CLI | — |
| Login 3 rôles | — | **Yes** |
| Push token role in DB | — | **Yes** |
| Mapbox map render | — | **Yes** |
| Stripe PaymentSheet | — | **Yes** |
| Restaurant Command Center | — | **Yes** |
| Universal links open app | — | **Yes** |

---

## Device checklist — PASS / FAIL

Install **same build** on iOS TestFlight + Android internal track.

### Auth

| # | Flow | iOS | Android | Notes |
|---|------|-----|---------|-------|
| 1 | Client login (email/password) | PASS / FAIL | PASS / FAIL | Lands on Client Home |
| 2 | Driver login | PASS / FAIL | PASS / FAIL | Lands on Driver tabs or onboarding |
| 3 | Restaurant login | PASS / FAIL | PASS / FAIL | Lands on Restaurant Home or gate |

### Push token role (Supabase `user_push_tokens`)

After login on each role, verify row:

```sql
SELECT user_id, role, expo_push_token, updated_at
FROM user_push_tokens
WHERE user_id = '<uuid>'
ORDER BY updated_at DESC;
```

| # | Role | DB `role` matches profile | PASS / FAIL |
|---|------|---------------------------|-------------|
| 4 | Client | `client` | |
| 5 | Driver | `driver` | |
| 6 | Restaurant | `restaurant` | |

### Mapbox

| # | Screen | Map tiles visible | PASS / FAIL |
|---|--------|-------------------|-------------|
| 7 | Driver map / restaurant live map | | |
| 8 | Client location picker (if used) | | |

### Stripe PaymentSheet

| # | Flow | Sheet opens, no crash | PASS / FAIL |
|---|------|----------------------|-------------|
| 9 | Food checkout (test card or cancel) | | |
| 10 | Delivery checkout (cancel OK) | | |

### Restaurant Command Center

| # | Flow | KPIs load, no 401 loop | PASS / FAIL |
|---|------|------------------------|-------------|
| 11 | Open from Restaurant Home | | |

### Universal links (Safari / Chrome on device)

| URL | Opens app screen | PASS / FAIL |
|-----|------------------|-------------|
| `https://www.mmddelivery.com/signup/client` | ClientAuth | |
| `https://www.mmddelivery.com/signup/driver` | DriverAuth | |
| `https://www.mmddelivery.com/signup/restaurant` | RestaurantAuth | |
| `https://www.mmddelivery.com/auth/reset-password` | ResetPassword | |
| `https://www.mmddelivery.com/r/TESTCODE` | Referral / driver auth | |

---

## Sign-off

When **all rows PASS**:

```
# docs/production/store-submission.env
STORE_SUBMISSION_DEVICE_SMOKE_DONE=true
UNIVERSAL_LINKS_DEVICE_CHECK_DONE=true
```

Re-run:

```powershell
node apps/web/scripts/store-submission-readiness.mjs --env docs/production/store-submission.env
```

Expected: `[PASS] device/b6_device_smoke` and Store Submission verdict **GO**.

| Founder | Date | Build # iOS | Build # Android |
|---------|------|-------------|-----------------|
| | | | |
