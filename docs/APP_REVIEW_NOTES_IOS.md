# App Review Notes — MMD Delivery (iOS)

Use these notes in App Store Connect for the **new build after 1.0 (71)**.

---

## Summary of fixes vs rejected build 71

### APPLE ISSUE #1 — Guideline 4 Design (Permissions / localization)
Permission purpose strings are localized for app languages **en, fr, es, ar, zh, ff** via Expo `locales` → Info.plist (`apps/mobile/ios-locales/*.json`).  
In-app UI uses react-i18next with the same six languages.  
Native dialogs follow the device language; in-app copy follows the user-selected app language.

### APPLE ISSUE #2 — Guideline 5.1.1(v) (Full Address)
Client **signup does not require** a full street address.  
Required at signup: email, password, full name, phone.  
Address is collected when a service needs it (Taxi pickup/destination, Food/Delivery dropoff, Marketplace checkout).  
Saved profile addresses remain optional convenience features.

### APPLE ISSUE #3 — Guideline 5.1.1(v) (Marketplace browse without account)
On **Choose your mode**, tap **Browse Marketplace** — no login.  
Guest can open shops, search, open product details (photos, price, description, availability).  
Login is required only for cart, checkout, payment, orders, wallet, and personal data.

### APPLE ISSUE #4 — Guideline 2.5.4 (Background audio) + Safety Audio
`UIBackgroundModes` = **`location`**, **`remote-notification`** only — **no `audio`**.  
MMD does **not** play persistent background audio.  
**Safety Audio** is a real in-ride security feature for **Client and Driver**:
- User must explicitly consent and start recording (never silent).
- Clear on-screen **RECORDING** indicator + timer.
- Foreground-only (`staysActiveInBackground: false`); leaving/locking may interrupt — disclosed in-app.
- Each party records **only their own device microphone**; files are separate and private; no cross-download.

---

## Marketplace seller account deletion (Guideline 5.1.1(v))

Marketplace Seller is created in-app (Role Select → sign up/login → Seller setup).  
**Delete account** is on **Seller Dashboard** and **Seller Setup**.  
Deletion requires the account password and typing DELETE. It anonymizes personal and shop data; financial records required by law are retained.

---

## Marketplace guest path

1. Launch app → **Browse Marketplace** (no account).
2. Open a shop → browse / search products → Product Details.
3. Add to cart → sign-in prompt (expected).

## Client signup (no mandatory full address)

1. Role → **Client** → Sign up.
2. Email, password, name, phone required; address optional.
3. Address asked later when ordering Taxi / Delivery / Marketplace checkout.

## Permissions (why)

| Permission | Why |
|------------|-----|
| Location | Nearby restaurants, pickup/dropoff, live driver tracking on active trips |
| Notifications | Order / ride / mission alerts |
| Camera | Optional safety video + delivery proof |
| Microphone | Optional **Safety Audio** (client + driver) and safety video audio — only after explicit start |
| Photos | Profile / proof images |

---

## Safety Audio — CLIENT

1. Login as **Client**.
2. Open **Taxi** → pickup + destination → book → wait until ride is active (`accepted` / `driver_arrived` / `in_progress`) with a driver assigned.
3. On tracking screen, open purple **Safety Audio** card.
4. Tap **Record** → read consent → confirm.
5. Allow **Microphone** if prompted.
6. Confirm red **RECORDING — your microphone is on** + timer/waveform (never silent).
7. Optionally background/lock: app warns recording may pause (no background audio mode).
8. Tap **Stop** → secure upload confirmation.
9. Optional: open **your** recording only from this card.

Client start does **not** turn on the driver’s microphone.

## Safety Audio — DRIVER

1. Login as **approved Driver**.
2. Go online → accept Taxi → arrive pickup → start ride (active trip card).
3. On the active ride card, use **Safety Audio** (same product, driver role).
4. Tap **Record** → consent → microphone → confirm **RECORDING** indicator.
5. Optionally test background/lock warning (foreground-only).
6. Tap **Stop** → upload confirmation.
7. Optional: **Safety video** below (separate consent; camera + mic; also never silent).

Driver start does **not** turn on the client’s microphone.  
Files: private bucket, ~14-day retention, **initiator-only** download; staff lock/review for incidents.

---

## Taxi / Driver GPS (general)

- Client Taxi booking uses Taxi APIs (separate from Food/Delivery).
- Driver GPS uses **location** background mode + **push** sounds for offers — not `UIBackgroundModes audio`.

## Demo accounts

Provide current App Review demo credentials in App Store Connect (founder-supplied — do not invent):

- **Client / Customer** — email + password (SMS OTP is **not** required). Use this account for Taxi, package Delivery, Food, Marketplace cart, receipts, and **Business wallet** (Taxi → Wallet).
- **Driver** — approved driver, email + password. Use for offers, active ride, Safety Audio, **Wallet / Cash Out**, and Stripe Express (payouts).
- **Restaurant** — order-eligible restaurant, email + password.
- Optional: **Marketplace Seller** to exercise in-app Delete account.

Business is **not** a separate signup role. It is a membership on a Customer account.

## How to test paid flows (backend is production: https://www.mmddelivery.com)

### Taxi (Customer)

1. Login as **Client** → Taxi → pickup + destination → quote → pay with Stripe test/live card as configured on the demo account.
2. Tracking, chat, receipt, and tip appear on the ride after payment / completion.
3. History: Taxi history from the Taxi home.

### Package Delivery (Customer)

1. Login as **Client** → Delivery → pickup + dropoff → quote → pay.
2. Open Delivery details / live tracking (driver ETA only after assignment).
3. Receipt after delivery.

### Driver Wallet / Cash Out

1. Login as **approved Driver**.
2. Open Wallet (Driver tabs — not customer Home).
3. **Available** is the server cash-out amount (not a client-typed figure). Cash Out requires Stripe Express onboarded.
4. Completed jobs credit earnings, then Stripe Connect transfer (SCT) into available balance; Sunday bank payout remains the weekly Connect payout path.
5. If Cash Out is blocked, the app shows the **server** reason (Stripe not ready, already cashed out today, below minimum) — do not expect a fake demo balance.

### Business wallet

1. Login as **Client** that is a taxi business member.
2. Taxi home → Wallet.
3. Summary, history, members (roster), top-up (Stripe). Cash-out only if the API returns `can_cashout`.

### Account deletion

- In-app: Settings / Security / Seller Dashboard → Delete account (password + type DELETE).
- Web (no login): https://www.mmddelivery.com/legal/account-deletion

## Marketplace checkout (launch / geo gate)

Guest **browse** works without an account. Cart/checkout require login.  
If checkout is not live in the reviewer’s county, the app shows that marketplace is not available in that area — it must not crash. Food, taxi, and package delivery are the primary paid demo flows.

## Universal Links

Canonical host is **https://www.mmddelivery.com**.  
Password reset and signup emails use that host. Apex `mmddelivery.com` redirects to www.

## Account deletion (Apple 5.1.1(v) + Google Play)

In-app: Settings / Security / Seller Dashboard → Delete account (password + type DELETE).  
Web (no app login required): **https://www.mmddelivery.com/legal/account-deletion**  
Also: support@mmddelivery.com or https://www.mmddelivery.com/contact  

Taxi Business wallet users delete via the **Customer** account that owns the membership.

## Store build pins (do not change without checking store rules)

- EAS production iOS image: `sdk-54` (Xcode 26 / iOS 26 SDK).
- Android `targetSdkVersion` / `compileSdkVersion`: **36** (Google Play requirement as of 31 Aug 2026).

## iPad

`supportsTablet: true`. Please also spot-check Role Select, Marketplace guest, Login, Taxi tracking, Driver active ride, Safety Audio on iPad.

## Important

Do **not** expect podcast-style background audio. Safety Audio is intentional, consented, indicated, and foreground-only.
