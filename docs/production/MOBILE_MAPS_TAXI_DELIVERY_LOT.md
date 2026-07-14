# Mobile maps / Taxi / Delivery lot validation

**Commit:** `7b7809a9fccd9111043094b6965c980c96b0f704`  
**UTC note:** 2026-07-14  
**Conclusion:** `MOBILE_MAPS_TAXI_DELIVERY_READY_WITH_DEVICE_GAPS`

## Delivered in code

- Shared `LiveTripMap` + `LiveEtaBanner` + `useLiveTripEta` / `mapboxLiveEta`
- Package delivery (`delivery_requests`) client Mapbox tracking with live driver, route, ETA
- Food order details: live ETA banner (existing map kept)
- Taxi tracking: shared LiveTripMap + live ETA + reconnect
- Mapbox Places autocomplete API + Taxi Home / Multi-stop UI
- Central reverse geocode (API → device → coords fallback) with cache
- GPS/permission helpers; offer expiry + accept conflict UX on DriverTaxiPanel
- Multi-stop quote-before-create flow preserved / tested as pure invariants

## Verified locally

| Check | Result |
|---|---|
| Mobile `tsc --noEmit` | PASS |
| Web `tsc --noEmit` | PASS |
| `pnpm test:maps` (mobile) | PASS |
| `pnpm test:maps-places-parse` (web) | PASS |
| Web lint | PASS (0 errors; pre-existing warnings) |
| Push `origin/main` | PASS |

## Not verified in this environment

| Check | Result |
|---|---|
| EAS Android preview | FAIL — local `EPERM` on Windows temp shallow-clone upload (no build ID) |
| EAS iOS preview | FAIL — non-interactive credentials missing for internal distribution (no build ID) |
| Device smoke Android/iOS | NOT RUN — no device farm / interactive session |

## Intentionally out of scope

Live marketplace/taxi payouts, financial migrations, commercial Marketplace enablement, full round-trip taxi pricing refactor, App Store / Play submission without binary + smoke.

## Operator follow-up

1. Re-run EAS from a clean environment (or WSL) with interactive iOS credentials.  
2. Install preview/production binary and run the smoke checklist (Taxi autocomplete, multi-stop quote cancel, package map, AppState resume).  
3. Treat native `expo-location` change as requiring a new binary before store upload.
