# MMD Identity Verification Architecture

**Status:** Production module (Enterprise)  
**Stripe account:** Single MMD Delivery Stripe account (Payments + Connect + Identity + Webhooks)  
**Mobile stack:** React Native / Expo (not Flutter)

## Official Stripe sources used

- [Verification Sessions](https://docs.stripe.com/identity/verification-sessions)
- [Create VerificationSession](https://docs.stripe.com/api/identity/verification_sessions/create)
- [Handle verification outcomes / webhooks](https://docs.stripe.com/identity/handle-verification-outcomes)
- [Verify identity documents (React Native)](https://docs.stripe.com/identity/verify-identity-documents?platform=react-native)
- [Connect identity verification](https://docs.stripe.com/connect/identity-verification)
- [Connect additional verifications / Identity](https://docs.stripe.com/connect/additional-verifications)
- [Connect handling API verification (`related_person`)](https://docs.stripe.com/connect/handling-api-verification)

## Design principles

1. **One Stripe account** — all Identity sessions are created with the platform `STRIPE_SECRET_KEY` (same key as Payments/Connect).
2. **Provider abstraction** — apps never call Stripe Identity APIs. They call `IdentityVerificationService` only.
3. **No document storage** — MMD stores session IDs, statuses, timestamps, failure codes/reasons, and non-sensitive metadata only. Images stay in Stripe Identity.
4. **Authoritative outcomes via webhooks** — never trust client redirects alone.
5. **Connect coexistence** — when a subject already has a Connect account + Person, sessions may pass `related_person` so Stripe can attach verification to Connect KYC where supported. Platform Identity gates remain independent of Connect payout readiness.
6. **Existing driver selfie gate** — `driver_identity_*` remains for risk/selfie ops. Stripe Identity is the **document + selfie KYC** gate for go-online / publish / activate when policy requires it. Both can coexist; policies decide which is mandatory.

## Subject types

| Subject | Default policy | Gate effect |
|---------|----------------|-------------|
| `driver` | Required before Online | Block `is_online` / new offers when not `verified` |
| `restaurant` | Required before activation | Block restaurant activation when not `verified` |
| `seller` | Required before publish/sell | Block listing publish when not `verified` |
| `business` | Configurable | Business-account activation |
| `client` | Off by default | Enable per feature flag (wallet high-risk, large payouts, fraud) |
| `admin` | Optional | Staff elevated actions (future) |

## Module layout

```
apps/web/src/lib/identityVerification/
  types.ts
  provider.ts                 # IdentityProvider interface
  providers/stripeIdentity.ts # Stripe Identity adapter
  policies.ts                 # Role/feature requirements
  service.ts                  # Orchestrator (only public entry)
  webhook.ts                  # identity.verification_session.*
  notifications.ts
  connectBridge.ts            # related_person helpers
  index.ts
```

## Data model

- `identity_verification_policies` — per subject_type / feature requirements
- `identity_verifications` — current verification state per subject
- `identity_verification_attempts` — immutable history of sessions
- `identity_verification_events` — audit log (webhook + admin actions)

## Session lifecycle (Stripe statuses)

`requires_input` → `processing` → `verified` | `requires_input` (retry) | `canceled` | `redacted`

Mapped to MMD: `pending` | `processing` | `verified` | `requires_input` | `failed` | `canceled` | `requires_review`

## Webhooks (same endpoint)

Extend `https://www.mmddelivery.com/api/stripe/webhook`:

- `identity.verification_session.created`
- `identity.verification_session.processing`
- `identity.verification_session.verified`
- `identity.verification_session.requires_input`
- `identity.verification_session.canceled`
- `identity.verification_session.redacted`

Signature verification uses existing `STRIPE_WEBHOOK_SECRET` (Founder must enable these event types on the Dashboard endpoint).

## Client UX

1. App calls `POST /api/identity/sessions` → receives `{ sessionId, url, ephemeralKeySecret? }`.
2. Preferred Expo-safe path: open hosted `url` via `expo-web-browser` with `return_url`.
3. Optional native path: `@stripe/stripe-identity-react-native` + ephemeral key (requires Identity enabled in Dashboard + native rebuild).
4. App polls `GET /api/identity/status` and relies on Realtime/`identity_verifications` updates for final state.

## Founder enablement (after Dashboard Identity is live)

```sql
update public.identity_verification_policies
set required = true, updated_at = now()
where subject_type in ('driver', 'restaurant', 'seller')
  and feature_key = 'default';
```

Default migration ships with `required = false` so production Online/activation is not hard-blocked before Stripe Identity is enabled.

## Future providers

Implement `IdentityProvider` for Persona / Veriff / Onfido. Switch via `identity_verification_policies.provider`. Apps unchanged.

## Founder enablement (after Identity is live in Dashboard)

Default policies ship with `required = false` so Online/activation is not blocked before Stripe Identity is enabled.

When ready:

```sql
update public.identity_verification_policies
set required = true, updated_at = now()
where subject_type in ('driver', 'restaurant', 'seller')
  and feature_key = 'default';
```

Also subscribe the production webhook endpoint to:

- `identity.verification_session.created`
- `identity.verification_session.processing`
- `identity.verification_session.verified`
- `identity.verification_session.requires_input`
- `identity.verification_session.canceled`
- `identity.verification_session.redacted`
