# iOS validation procedure (macOS required)

Host used for pre-build certification: **Windows** — Xcode / iOS Simulator / `xcodebuild` are **not available**.  
Do **not** mark iOS compile / Simulator / device as PASS until the steps below succeed on a Mac.

## Reference (App Store protected)

| Item | Value |
|---|---|
| ASC version / build | **1.0.1 / 89** Ready for Distribution |
| Store Git pin | `3152ebf28d4da7eb648827c64a7f0a6130dec8c3` |
| Current cert HEAD (example) | `a811101f`+ — **do not OTA onto 89** |
| Bundle ID | `com.maladho2025.mmddelivery` |
| `ios.version` (repo) | `1.0.1` |
| Apple Pay merchant | `merchant.com.maladho2025.mmddelivery` |
| Associated domain | `applinks:www.mmddelivery.com` |
| Locales | `en`, `fr`, `es`, `ar`, `zh`, `ff` |
| EAS profiles | `preview`, `ios-simulator`, `production` |

**Forbidden without founder approval:** OTA (`runtimeVersion` 1.0.0), `eas build --profile production`, `eas submit`, App Store publish, changing `app.json` iOS entitlements/bundle.

---

## 0. Prerequisites (macOS)

```bash
xcode-select -p
xcodebuild -version
node -v
pnpm -v
eas --version
git -C /path/to/MMD-Delivery rev-parse --short HEAD
```

```bash
cd /path/to/MMD-Delivery
pnpm install
cd apps/mobile
# Confirm test Stripe publishable key in local env (pk_test only for cert)
grep -E '^EXPO_PUBLIC_STRIPE' .env | sed 's/=.*/=***/'
```

---

## 1. Simulator compile (allowed without store IPA)

```bash
cd /path/to/MMD-Delivery
pnpm install
cd apps/mobile

# Generate native ios/ (CNG — do not commit ios/)
npx expo prebuild --platform ios --clean

# Preferred local simulator run
npx expo run:ios
# OR local EAS simulator artifact (still NOT store distribution)
# eas build --platform ios --profile ios-simulator --local
```

**PASS when:** app boots on Simulator without redbox → Country / Role select.

**Record:** Xcode version, Simulator device name, commit SHA, screenshot boot.

---

## 2. Physical device (preview only — no App Store)

```bash
# Internal distribution ONLY — ask founder before running
cd /path/to/MMD-Delivery/apps/mobile
eas build --platform ios --profile preview
# Install via QR / internal link — NOT TestFlight App Store track unless approved
```

**Do not run** without approval:

```bash
# FORBIDDEN unless founder explicitly authorizes a new store binary
# eas build --platform ios --profile production
# eas submit --platform ios --latest
```

---

## 3. Matrix to execute on Mac / device

| Area | Where | How | Result |
|---|---|---|---|
| GPS When In Use | Sim + device | Taxi / Delivery ; accept prompt ; map pin | |
| GPS Always / background | **Device** | Live trip ; lock screen ; updates continue | |
| APNs | **Device** | Grant notifications ; trigger test push | |
| Deep links | Sim + device | `xcrun simctl openurl booted "https://www.mmddelivery.com/..."` / Universal Link | |
| Stripe test card | Sim/device **pk_test** | Taxi quote → Card → PaymentSheet ; 4242 / decline / cancel | |
| Apple Pay | **Device** Wallet sandbox | Platform Pay ; confirm `livemode=false` | |
| Six languages | Sim | Switch en/fr/es/ar/zh/ff | |
| RTL Arabic | Sim | Layout mirrors ; no clipped CTAs | |

### Deep link helper (Simulator)

```bash
xcrun simctl list devices booted
xcrun simctl openurl booted "mmddelivery://"
xcrun simctl openurl booted "https://www.mmddelivery.com/"
```

### Stripe test on iOS (pk_test build only)

Follow `docs/production/STRIPE_US_PAYMENTSHEET_MANUAL_UI.md` on the Simulator/device build — **not** on App Store 89.

---

## 4. Windows-compatible checks (already done — do not redo without cause)

- Bundle / merchant / associated domains / locales present in `app.json`
- `eas.json` production channel + `ascAppId` documented
- No `app.json` / `eas.json` drift vs store commit for iOS identity

---

## 5. Record results

Write into `docs/production/reports/` (local) or founder notes:

- Compile: PASS / FAIL + Xcode version  
- Simulator smoke: PASS / FAIL  
- Device permissions / APNs / Apple Pay / GPS background: PASS / FAIL / SKIPPED  
- Confirm: **no OTA**, **no store IPA**, **no ASC submit**

Until Mac steps run, iOS Simulator / device / APNs / Apple Pay remain **BLOCKED** on Windows.
