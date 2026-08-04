# Client identity rollout

Progressive, safe rollout for email verification, Twilio Verify phone OTP, profile completeness, and Admin Clients CRM.

## Goals

- New clients: email verify → phone Verify (when enabled) → complete profile (name, photo, Mapbox address) → full access.
- Existing clients: never auto-deleted; guided to complete missing fields.
- Admin `/admin/clients`: real + active by default; filters for test / certification / deleted / suspended.

## Environment flags

| Variable | Default | Purpose |
|----------|---------|---------|
| `REQUIRE_EMAIL_VERIFICATION` | `false` | Gate full web usage on Auth `email_confirmed_at` |
| `PHONE_OTP_ENABLED` | `false` | Enable Twilio Verify start/check APIs and hard phone gate |
| `TWILIO_VERIFY_SERVICE_SID` | — | Twilio Verify Service SID |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` | — | Existing Twilio credentials |
| `EXPO_PUBLIC_PHONE_OTP_ENABLED` | unset | Mobile hard gate for phone verified |
| `EXPO_PUBLIC_REQUIRE_EMAIL_VERIFICATION` | unset | Mobile hard gate for email verified |

## Migration

File: `supabase/migrations/20261105120000_client_identity_account_kind.sql`

Adds on `profiles`:

- `account_kind` (`real|demo|test|certification`)
- `phone_verified_at`
- `phone_e164`
- Partial unique index on verified active client phones

Backfill heuristics classify `@mmd.test`, `e2e.*`, `+cert-`, etc. No rows deleted.

### Apply

```bash
npx supabase db push
# or link + migration up on the target project
```

### Rollback (manual)

```sql
drop index if exists profiles_client_phone_e164_verified_uidx;
alter table public.profiles drop constraint if exists profiles_account_kind_check;
alter table public.profiles drop column if exists phone_e164;
alter table public.profiles drop column if exists phone_verified_at;
alter table public.profiles drop column if exists account_kind;
```

## APIs

- `POST /api/auth/phone/start` — Twilio Verify start (rate limited)
- `POST /api/auth/phone/check` — Twilio Verify check → writes `phone_verified_at` / `phone_e164`
- `GET /api/admin/clients` — enriched CRM list (filters, pagination, badges, completeness)

## Completeness

Shared scorer: `shared/profileCompleteness.ts` (`@mmd/profile-completeness`).

## Multi-role matrix

| Role | Email | Phone Verify | Profile / address | Notes |
|------|-------|--------------|-------------------|-------|
| Client | Required (flag) | Twilio Verify (flag) | Photo, name, Mapbox address | This rollout |
| Driver | Existing gate | Future optional | Onboarding docs | Unchanged |
| Restaurant | Existing | Future optional | Geocode at signup | Unchanged |
| Seller / Business | Existing | Future optional | Onboarding | Unchanged |

## Safety

- No payment / order / wallet mutations in this rollout (wallet shown read-only in admin).
- Phone uniqueness only among **verified + active + client**.

## Performance notes

- Admin CRM loads Auth `email_confirmed_at` via parallel `getUserById` for the current page (not sequential).
- Future optimization: denormalize `email_confirmed_at` onto `profiles` (or a small RPC) to remove Auth Admin round-trips entirely.
