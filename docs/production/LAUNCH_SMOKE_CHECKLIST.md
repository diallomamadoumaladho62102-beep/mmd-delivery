# Launch smoke checklist — MMD Delivery

Install the **same EAS production build** on iOS (TestFlight) and Android (Play internal track).

Mark each item **PASS / FAIL** with device model and build number.

## Auth (all roles)

| # | Flow | iOS | Android |
|---|------|-----|---------|
| 1 | Client login | | |
| 2 | Driver login | | |
| 3 | Restaurant login | | |
| 4 | Admin web login | | |
| 5 | Push token `role` matches profile in DB | | |

## Food (critical path)

| # | Flow | iOS | Android |
|---|------|-----|---------|
| 6 | Search + filter restaurants | | |
| 7 | Menu + variants + cart | | |
| 8 | Stripe checkout → paid | | |
| 9 | Restaurant accept (manual/auto) | | |
| 10 | Driver dispatch + navigation | | |
| 11 | Pickup proof (private bucket) | | |
| 12 | Delivery proof + client notification | | |
| 13 | Cancel + refund (staging) | | |
| 14 | Rating after delivery | | |

## Package

| # | Flow | iOS | Android |
|---|------|-----|---------|
| 15 | Create delivery request + pay | | |
| 16 | Dispatch waves (driver receives offer) | | |
| 17 | Pickup + delivery proof | | |
| 18 | GPS tracking visible to client | | |

## Taxi (regression only — frozen)

| # | Flow | iOS | Android |
|---|------|-----|---------|
| 19 | Immediate ride quote + pay | | |
| 20 | Navigation + arrival | | |
| 21 | Safety recording consent (if enabled) | | |
| 22 | Complete + rating | | |

## Wallet & payments

| # | Flow | iOS | Android / Web |
|---|------|-----|---------------|
| 23 | No double charge on retry | | |
| 24 | Payment history visible | | |
| 25 | Driver payout preview (staging) | | |

## Notifications

| # | Flow | iOS | Android |
|---|------|-----|---------|
| 26 | MMD sound on order accepted | | |
| 27 | Driver mission push | | |
| 28 | Silent mode respected | | |

## Admin

| # | Flow | Web |
|---|------|-----|
| 29 | Dashboard KPIs load | |
| 30 | Manual dispatch override | |
| 31 | Audit log entry on sensitive action | |

## Build / deep links

| # | Flow | iOS | Android |
|---|------|-----|---------|
| 32 | Universal link opens app | | |
| 33 | Mapbox tiles render | | |
| 34 | Background location during active trip | | |

**Sign-off:** set `STORE_SUBMISSION_DEVICE_SMOKE_DONE=true` after all critical paths (6–12, 15–17, 19–20, 23–24, 26–27, 32–33) pass on both platforms.

See also: `docs/production/B6_STORE_SUBMISSION_DEVICE_SMOKE.md`
