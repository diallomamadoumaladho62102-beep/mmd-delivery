# Google Play Data Safety mapping (code → declaration)

Fill Play Console Data Safety from this map. **OPS:** submit the form in Play Console; this file is the source of truth in-repo.

| Data type | Collected? | Shared? | Purpose in code | Notes |
|-----------|------------|---------|-----------------|-------|
| Location (precise) | Yes | With the other party on an active job | Driver tracking, dispatch, quotes, maps | Background location only after in-app disclosure (`apps/mobile/src/lib/location.ts`) |
| Location (approximate) | Yes | No (ops/admin) | Market / county availability | |
| Personal info (name, email, phone) | Yes | Job counterpart as needed | Accounts, SMS/Verify, support | |
| Photos | Yes | Delivery proof / profile | Image picker + camera | Images only; no `READ_MEDIA_VIDEO` today |
| Audio | Yes | Safety / support if used | Safety Audio is **foreground** | Do not declare background audio |
| Financial info | Yes (via Stripe) | Stripe | Payments, payouts, Connect | MMD does not store full card numbers |
| Device IDs / crash logs | Yes | Sentry if configured | Diagnostics | No ATT / IDFA |
| Contacts | No (unless user pastes a phone) | No | — | Do not declare contacts unless a picker is added |
| Messages (in-app chat) | Yes | Job counterpart | Order/ride chat | |

Account deletion URL for Play listing: `https://www.mmddelivery.com/legal/account-deletion`

Privacy: `https://www.mmddelivery.com/legal/privacy`

Foreground service location is declared for driver tracking. Keep the disclosure **before** `requestBackgroundPermissionsAsync()`.
