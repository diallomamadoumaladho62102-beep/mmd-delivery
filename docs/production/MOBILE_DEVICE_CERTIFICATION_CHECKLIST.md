# Mobile device certification checklist

Sign-off for **TestFlight (iOS)** and **Android Production** before public launch.  
Attach screenshots or screen recordings to `docs/production/reports/mobile/` (do not commit secrets).

## How to mark PASS / FAIL

| Result | Meaning |
|--------|---------|
| **PASS** | Screen matches expected behavior; currency and country consistent |
| **FAIL** | Wrong currency, wrong market, crash, or client-side amount shown as editable source of truth |
| **SKIP** | Feature disabled by launch control in that market (document why) |

---

## iOS TestFlight — United States (USD)

| # | Screen / flow | Capture required | PASS / FAIL | Notes |
|---|---------------|------------------|-------------|-------|
| 1 | Client Home | Scope label shows US; services visible | | |
| 2 | Food — menu | Restaurant list filtered to US market | | |
| 3 | Food — quote | Total from server; currency **USD** | | |
| 4 | Food — create | Order created via API (no manual total entry) | | |
| 5 | Delivery — quote | Server quote; currency **USD** | | |
| 6 | Delivery — create | Request created via API | | |
| 7 | Taxi Home | Taxi available for US | | |
| 8 | Taxi — quote | Server quote; currency **USD** | | |
| 9 | Driver Home | Inbox loads; no timeout | | |
| 10 | Restaurant Home | Orders list loads | | |
| 11 | MMD AI | Assistant entry visible if `ai_assistant_available` | | |

**Build info:** TestFlight build number __________ · Date __________

---

## iOS TestFlight — Guinea (GNF)

| # | Screen / flow | Capture required | PASS / FAIL | Notes |
|---|---------------|------------------|-------------|-------|
| 1 | Client Home | Scope shows Guinea; currency context **GNF** | | |
| 2 | Food — quote | Currency **GNF** (not USD fallback) | | |
| 3 | Food — create | Order via API | | |
| 4 | Delivery — quote / create | GNF consistent | | |
| 5 | Taxi — quote | GNF consistent | | |
| 6 | Driver / Restaurant / AI | Same as US table | | |

**Build info:** TestFlight build number __________ · Date __________

---

## Android Production — United States (USD)

| # | Screen / flow | Capture required | PASS / FAIL | Notes |
|---|---------------|------------------|-------------|-------|
| 1 | Client Home | US scope | | |
| 2 | Food quote / create | USD | | |
| 3 | Delivery quote / create | USD | | |
| 4 | Taxi Home / quote | USD | | |
| 5 | Driver Home | Inbox OK | | |
| 6 | Restaurant Home | Orders OK | | |
| 7 | MMD AI | Per launch control | | |

**Build info:** Play track __________ · versionCode __________ · Date __________

---

## Android Production — Guinea (GNF)

| # | Screen / flow | Capture required | PASS / FAIL | Notes |
|---|---------------|------------------|-------------|-------|
| 1 | Client Home | Guinea scope | | |
| 2 | Food / Delivery / Taxi | **GNF** throughout | | |
| 3 | No USD fallback on GN coords | Critical | | |
| 4 | Driver / Restaurant / AI | Same pattern | | |

---

## Payment smoke (optional — Live, founder only)

Only when `CERTIFICATION_ALLOW_LIVE_PAYMENT=true` in certification env.

| Flow | Step | Expected | PASS / FAIL |
|------|------|----------|-------------|
| Food | Pay → webhook | `payment_status=paid` once | |
| Delivery | Pay → webhook | Single paid transition | |
| Taxi | Pay → complete | Paid once, no duplicate session | |

---

## Founder sign-off

| Item | Initials | Date |
|------|----------|------|
| iOS TestFlight US | | |
| iOS TestFlight GN | | |
| Android US | | |
| Android GN | | |
| No dangerous currency fallback observed | | |

When all rows are **PASS**, set in `final-certification.env`:

```
TESTFLIGHT_US_CHECK_DONE=true
TESTFLIGHT_GN_CHECK_DONE=true
ANDROID_US_CHECK_DONE=true
ANDROID_GN_CHECK_DONE=true
```
