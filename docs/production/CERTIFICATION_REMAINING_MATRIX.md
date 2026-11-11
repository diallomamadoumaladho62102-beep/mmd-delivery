# Certification remaining matrix (App Store 1.0.1 / build 89 protected)

Last update: 2026-11-11 · HEAD on `main`  
**Do not declare full certification complete while any obligatory item is BLOCKED.**

## Executed (proved)

| Area | Result | Evidence |
|---|---|---|
| App Store 89 protected | PASS | No OTA / store IPA; `TaxiQuoteScreen` still has `WebBrowser.openBrowserAsync` fallback (store Checkout path preserved in source; binary 89 unchanged) |
| Stripe API sk_test succeed/decline/cancel | PASS | `scripts/stripe-us-paymentsheet-cert.mjs` |
| PaymentSheet open (emulator-5556) | PASS | `PaymentSheetActivity` + Card form TEST |
| PaymentSheet cancel / dismiss | PASS | 2026-11-11 emulator-5556: Close sheet on `pi_3UaXu9…` → still `requires_payment_method`, 0 rides |
| PI taxi open | PASS (state) | `pi_3UaXu9…` amount **2333** USD, `requires_payment_method`, `livemode=false` |
| No public taxi ride from open sheet | PASS | 0 rides for E2E client since cert window |
| US driver / restaurant / seller login + isolation | PASS | Non-approved, offline, dispatch-isolated |
| Guinea client/driver/restaurant/seller login | PASS | Isolated accounts unchanged |
| US E2E client login | PASS | Session OK |
| i18n coverage 100% + 6-language keys for cert fill | PASS | `test:i18n-coverage`, `fullScreenI18n`, `languageSwitch` (RTL=ar only) |
| Autocomplete coords contract | PASS | `taxi-us-cert-fill.regression.test.mjs` |
| CI / Semgrep / ZAP / CodeQL / Vercel (prior greens) | PASS | Re-verify after each push |
| Secret scan | PASS | 0 findings |

## Stripe UI card outcomes

| Case | Result | Note |
|---|---|---|
| Accept `4242…` via PaymentSheet UI | **BLOCKED** | ADB insecure. **One manual session** (see `FINAL_VALIDATION_DOSSIER.md` §H + `verify-paymentsheet-manual-session.mjs --accept-pi=`). Do not treat API cert succeeds as UI PASS. |
| Decline `4000…0002` via PaymentSheet UI | **BLOCKED** | Same session: new quote → decline card → `--decline-pi=`. |
| OTA freeze store 89 | **PASS** (armed) | `scripts/assert-store89-ota-freeze.mjs` blocks `--channel=production` while `runtimeVersion=1.0.0` |

Form left cleared for manual entry (Card number empty, sheet still open / reopen via Carte bancaire).

## Blocked — external environment

| Area | Result | Why |
|---|---|---|
| iOS Simulator / Xcode | BLOCKED | Host is Windows — see `IOS_MACOS_VALIDATION_PROCEDURE.md` |
| iOS physical device | BLOCKED | Needs Mac + device |
| APNs | BLOCKED | Needs device + push entitlement build |
| Apple Pay | BLOCKED | Needs device Wallet sandbox + pk_test build |
| Stripe PaymentSheet on iOS | BLOCKED | Needs iOS build |

## Forbidden without founder approval

OTA · `eas build --profile production` · `eas submit` · App Store publish · changing build 89 Checkout · live Stripe/Supabase secret edits · approving test pros.
