# Universal links — device readiness

## Code / prod status: PASS (automated)

Verified by:

- `apps/web/public/.well-known/apple-app-site-association` — includes `/signup/*`, `/auth/*`, `/r/*`, `/reset-password`
- `apps/web/public/.well-known/assetlinks.json` — package `com.maladho2025.mmddelivery` + SHA256
- `app.config.ts` — iOS `associatedDomains`, Android `intentFilters` with `autoVerify: true`
- `apps/mobile/src/lib/deepLinkPaths.ts` — canonical paths aligned with `AppNavigator` linking

## Device verification (required before store upload)

| Link | Expected screen | iOS | Android |
|------|-----------------|-----|---------|
| `/signup/client` | ClientAuth | | |
| `/signup/driver` | DriverAuth | | |
| `/signup/restaurant` | RestaurantAuth | | |
| `/auth/reset-password` | ResetPassword | | |
| `/r/<CODE>` | Referral flow | | |

**How to test:** paste each URL in Safari (iOS) or Chrome (Android). App should open without browser login page.

**Android note:** if link opens browser, verify Play App Signing SHA256 matches `assetlinks.json` fingerprint.

**Sign-off:** `UNIVERSAL_LINKS_DEVICE_CHECK_DONE=true` in `store-submission.env` after all PASS.

See also: `B6_STORE_SUBMISSION_DEVICE_SMOKE.md` § Universal links.
