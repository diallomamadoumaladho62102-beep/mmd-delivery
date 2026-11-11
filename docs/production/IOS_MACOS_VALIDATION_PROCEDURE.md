# iOS validation procedure (macOS required)

Host used for pre-build certification: **Windows** — Xcode / iOS Simulator / `xcodebuild` are **not available**.  
Do **not** mark iOS compile as PASS until the steps below succeed on a Mac.

Reference app config (already verified on Windows):
- Bundle ID: `com.maladho2025.mmddelivery`
- Version: `1.0.1` (`apps/mobile/app.json`)
- Locales: `en`, `fr`, `es`, `ar`, `zh`, `ff`
- Associated domain: `applinks:www.mmddelivery.com`
- Apple Pay merchant: `merchant.com.maladho2025.mmddelivery`
- EAS profiles: `preview`, `ios-simulator`, `production`

## 0. Prerequisites

```bash
# On macOS only
xcode-select -p
xcodebuild -version
node -v
pnpm -v
eas --version
```

Install Xcode + Command Line Tools, CocoaPods (via Expo prebuild), and sign in to Apple Developer / EAS.

```bash
cd apps/mobile
pnpm install
```

## 1. Compile (simulator)

```bash
cd /path/to/MMD-Delivery
pnpm install
cd apps/mobile

# Generate native ios/ (CNG — do not commit ios/)
npx expo prebuild --platform ios --clean

# Simulator build via EAS local or Expo
eas build --platform ios --profile ios-simulator --local
# OR
npx expo run:ios
```

Success criteria: app launches on Simulator without redbox; boot reaches Country / Role select.

## 2. Device / TestFlight build

```bash
eas build --platform ios --profile preview
# or production profile when releasing
eas build --platform ios --profile production
eas submit --platform ios --latest   # only when intentionally submitting
```

Install via TestFlight on a physical iPhone.

## 3. Permissions checklist (physical device)

| Permission | How to verify |
|---|---|
| Location (When In Use) | Start Taxi / Delivery; accept prompt; map shows user |
| Location (Always / background) | Background a live trip; location updates continue while locked |
| Notifications (APNs) | Grant prompt; trigger a test push from backend to this install |
| Camera | Driver/restaurant document upload |
| Microphone | In-app call / voice features if enabled |
| Photo library | Avatar / menu photo pickers |

## 4. Essential journeys (device)

1. Client login (US + GN accounts as required)
2. Taxi quote → payment path (Stripe **test** keys only on non-prod builds)
3. Delivery request create
4. Language switch including Arabic RTL
5. Logout / role switch

## 5. Apple Pay (only if configured for the build)

```bash
# Confirm merchant ID in Apple Developer + Stripe Dashboard
# Merchant: merchant.com.maladho2025.mmddelivery
```

On device with a Wallet card in **Sandbox/test**:
1. Reach PaymentSheet / Platform Pay
2. Complete Apple Pay sheet with a sandbox card
3. Confirm order `payment_status=paid` and Stripe `livemode=false` for test builds

Skip Apple Pay sign-off if the build is Expo Go or merchant ID is not wired.

## 6. APNs

1. Confirm push entitlement on the installed build
2. Register device token after login
3. Send a test notification (order update / chat)
4. Verify delivery on lock screen + in-app handling

## 7. GPS

1. Grant location
2. Taxi pickup/dropoff map
3. Background location during an active trip (physical device)

## 8. Record results

Update `docs/production/reports/MMD-FINAL-MISSION-COMPLETE-PREBUILD.md`:

- Compile: PASS / FAIL + Xcode version
- Simulator smoke: PASS / FAIL
- Device permissions: table above
- APNs / Apple Pay / background GPS: PASS / FAIL / SKIPPED

Until this Mac procedure is executed, iOS remains **PARTIAL / BLOCKED** on Windows hosts.
