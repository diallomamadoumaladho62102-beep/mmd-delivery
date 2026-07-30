# Enterprise physical device certification checklist

Founder-owned after iOS/Android builds. Complete **after** the Live payment campaign.  
Do **not** mark `TESTFLIGHT_*` / `ANDROID_*` in `final-certification.env` until every required row is PASS.

Related: [`MOBILE_DEVICE_CERTIFICATION_CHECKLIST.md`](./MOBILE_DEVICE_CERTIFICATION_CHECKLIST.md), [`RESTAURANT_COMMAND_CENTER_DEVICE_CERTIFICATION.md`](./RESTAURANT_COMMAND_CENTER_DEVICE_CERTIFICATION.md).

## How to score

| Result | Meaning |
|--------|---------|
| **PASS** | Behavior matches production expectations; currency/locale correct |
| **FAIL** | Crash, wrong market/currency, broken focus, unusable contrast, or blocked critical path |
| **SKIP** | Feature disabled by launch control in that market (document why) |

---

## 1. Devices matrix

| Surface | Build / URL | OS / browser | Tester | Date | Overall |
|---------|-------------|--------------|--------|------|---------|
| iPhone | TestFlight production | iOS __ | | | |
| Android phone | Play internal/production | Android __ | | | |
| Tablet (iPad or Android) | Same build family | | | | |
| Web Desktop | https://www.mmddelivery.com | Chrome / Safari / Edge | | | |

---

## 2. Functional smoke (all surfaces)

| # | Flow | iPhone | Android | Tablet | Web |
|---|------|--------|---------|--------|-----|
| 1 | Auth sign-in / sign-out | | | | |
| 2 | Client home + market scope (US) | | | | |
| 3 | Food quote → create → pay return | | | | |
| 4 | Taxi quote → Stripe pay → ride created → map (Mapbox) | | | | |
| 5 | Delivery quote → create | | | | |
| 6 | Driver inbox / offer | | | | |
| 7 | Restaurant orders / Command Center | | | | |
| 8 | Seller orders / wallet | | | | |
| 9 | Business wallet summary | | | | |
| 10 | MMD Plus summary / portal entry | | | | |
| 11 | Receipt screen + PDF share/print | | | | |
| 12 | Financial history / timeline | | | | |
| 13 | Push / in-app notification open | | | | |
| 14 | Deep link / universal link resume | | | | |
| 15 | Permissions: location, notifications, camera (as needed) | | | | |

---

## 3. Accessibility — VoiceOver (iPhone / iPad)

| # | Check | PASS / FAIL | Notes |
|---|-------|-------------|-------|
| 1 | VoiceOver on: primary CTAs announced with role + name | | |
| 2 | Tab / swipe order follows visual reading order | | |
| 3 | Form fields have accessible labels (not placeholder-only) | | |
| 4 | Errors announced (live region or focus move) | | |
| 5 | Map controls reachable; map-unavailable fallback readable | | |
| 6 | Receipt amounts announced with currency | | |
| 7 | Modal sheets dismissible; focus returns | | |

---

## 4. Accessibility — TalkBack (Android)

| # | Check | PASS / FAIL | Notes |
|---|-------|-------------|-------|
| 1 | TalkBack on: primary CTAs have contentDescription / labels | | |
| 2 | Explore-by-touch order is logical | | |
| 3 | Checkout / PaymentSheet remains operable | | |
| 4 | Lists (orders, rides, wallet) announce item state | | |
| 5 | Decorative icons ignored or labeled correctly | | |

---

## 5. Dynamic Type / font scaling

| # | Check | iPhone | Android | Notes |
|---|-------|--------|---------|-------|
| 1 | Largest accessibility text: headers wrap, no clipped CTAs | | | |
| 2 | Wallet balances remain readable | | | |
| 3 | Taxi quote breakdown does not overflow off-screen | | | |
| 4 | No overlapping text on receipt | | | |

---

## 6. Keyboard & focus (Web Desktop + tablet keyboard)

| # | Check | PASS / FAIL | Notes |
|---|-------|-------------|-------|
| 1 | Tab reaches all interactive controls | | |
| 2 | Visible focus ring on buttons/inputs/links | | |
| 3 | Enter/Space activates primary buttons | | |
| 4 | Esc closes dialogs / sheets | | |
| 5 | Admin / seller / restaurant web shells keyboard-navigable | | |

---

## 7. Contrast & visual

| # | Check | PASS / FAIL | Notes |
|---|-------|-------------|-------|
| 1 | Body text vs background meets readable contrast | | |
| 2 | Error / success states not color-only | | |
| 3 | Disabled controls visually distinct | | |
| 4 | Map overlays remain legible in daylight | | |

---

## 8. Orientation & responsive

| # | Check | Phone | Tablet | Web |
|---|-------|-------|--------|-----|
| 1 | Portrait primary flows usable | | | |
| 2 | Landscape: no critical controls off-canvas | | | |
| 3 | Rotation mid-checkout does not lose session | | | |
| 4 | Desktop ≥1280px: no mobile-only dead ends for web portals | | | |
| 5 | Narrow mobile web (if used): tap targets ≥44px | | | |

---

## 9. Localization / formatters (device)

| # | Check | US | GN (if enabled) |
|---|-------|----|-----------------|
| 1 | Currency uses shared money formatter | | |
| 2 | Distances use shared distance formatter | | |
| 3 | Dates/times use locale-aware formatter | | |
| 4 | Receipt strings from i18n keys (no hard-coded currency symbols alone) | | |

---

## 10. Sign-off

| Item | Initials | Date |
|------|----------|------|
| iPhone VoiceOver + Dynamic Type | | |
| Android TalkBack + font scale | | |
| Tablet orientation + responsive | | |
| Web Desktop keyboard + contrast | | |
| No blocking a11y defect for Enterprise launch | | |

When **all required** rows are PASS, set in `docs/production/final-certification.env`:

```
TESTFLIGHT_US_CHECK_DONE=true
TESTFLIGHT_GN_CHECK_DONE=true
ANDROID_US_CHECK_DONE=true
ANDROID_GN_CHECK_DONE=true
```

Then re-run:

```powershell
node apps/web/scripts/final-production-certification.mjs --env docs/production/final-certification.env
```
