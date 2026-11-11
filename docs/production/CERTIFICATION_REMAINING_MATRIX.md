# Certification remaining matrix (App Store 1.0.1 / build 89 protected)

Last update: 2026-11-11 · HEAD tracking `main`  
**Do not declare full certification complete while any obligatory item is BLOCKED.**

## Executed (do not re-run without cause)

| Area | Result | Evidence |
|---|---|---|
| App Store 89 protected | PASS | No OTA / no store IPA; Checkout browser path untouched in published binary |
| Stripe API sk_test succeed/decline/cancel | PASS | `scripts/stripe-us-paymentsheet-cert.mjs` |
| PaymentSheet open (Android emulator) | PASS | `PaymentSheetActivity` + Card form TEST |
| PaymentSheet cancel / dismiss | PASS | Prior + back dismiss |
| US driver/restaurant/seller login | PASS | Isolated `@example.com` accounts |
| US isolation (non-approved / offline / dispatch guard) | PASS | `US_ISOLATED_TEST_USER_IDS` + pro rows absent/non-approved |
| Guinea isolated logins | PASS | Prior smoke |
| CI / Semgrep / ZAP / CodeQL / Vercel | PASS | `25707fa2`+ |
| GPS autocomplete coords race fix | PASS | `a811101f` + regression |

## In progress / awaiting operator

| Area | Result | Next action |
|---|---|---|
| PaymentSheet accept `4242` | BLOCKED → PENDING operator | Enter card on emulator-5556; agent verifies PI `succeeded` + no public ride |
| PaymentSheet decline `4000…0002` | BLOCKED → PENDING operator | New quote then decline card; agent verifies declined PI |

## Blocked on environment (macOS / device)

| Area | Result | Procedure |
|---|---|---|
| iOS Simulator compile | BLOCKED (Windows) | `docs/production/IOS_MACOS_VALIDATION_PROCEDURE.md` §1 |
| iOS physical device | BLOCKED | Same §2 preview only — no store profile |
| GPS background (device) | BLOCKED | Same §3 |
| APNs | BLOCKED | Same §3 / §6 |
| Apple Pay (Wallet sandbox) | BLOCKED | Same §5 — pk_test build only |
| Stripe PaymentSheet on iOS | BLOCKED | Same + `STRIPE_US_PAYMENTSHEET_MANUAL_UI.md` |
| Six languages + Arabic RTL (device re-cert) | NOT TESTED this wave | Re-run only if i18n strings change |

## Forbidden without founder approval

- OTA on `runtimeVersion` 1.0.0  
- `eas build --profile production` / `eas submit`  
- App Store publish  
- Changing build 89 Checkout path  
- Stripe/Supabase production secret changes  
