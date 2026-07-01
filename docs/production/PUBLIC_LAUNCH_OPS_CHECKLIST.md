# Public launch ops checklist

Use this after code/CI is green. **Do not mark an item done unless you verified it in the target environment.**

Legend: **CODE** = verified in repo/CI · **OPS** = manual external action required

---

## A. Repository & CI (CODE)

| # | Item | How to verify | Status |
|---|------|---------------|--------|
| A1 | GitHub Actions CI passes on `main` | Actions tab → latest workflow green | OPS |
| A2 | `pnpm test:ci` passes locally | Run from repo root | CODE |
| A3 | Migration files valid | `node scripts/verify-migration-files.mjs` | CODE |
| A4 | No secrets in git | `.env*` gitignored; no `sk_live` in history | CODE |
| A5 | Dev artifacts excluded | `docs/screenshots/`, `.expo/`, reports gitignored | CODE |
| A6 | ESLint in CI | Workflow runs `pnpm --dir apps/mobile lint && pnpm --dir apps/web lint` | CODE |
| A7 | Transactional hooks env-gated | `TRANSACTIONAL_*_ENABLED=false` by default in `.env.example` | CODE |

---

## B. Supabase production (OPS)

| # | Item | Action |
|---|------|--------|
| B1 | Link CLI to prod project | `supabase link --project-ref YOUR_REF` |
| B2 | Apply all pending migrations | `supabase db push` |
| B3 | Run certification SQL | `docs/production/sql/final_certification_checks.sql` |
| B4 | Set Edge secret | `MMD_STRIPE_WEBHOOK_DISABLED=true` on Edge `stripe_webhook` |
| B5 | Set Edge secret | `MMD_EDGE_PAYOUTS_DISABLED=true` on payout Edge functions |
| B6 | Confirm RLS trust boundary | No client INSERT on `orders`, `delivery_requests`, `taxi_rides` |
| B7 | Storage buckets | Delivery proofs, tax PDF buckets exist with correct policies |

**Not verifiable from repo alone.**

---

## C. Vercel production (OPS)

| # | Variable / item | Notes |
|---|-----------------|-------|
| C1 | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Production project |
| C2 | `SUPABASE_SERVICE_ROLE_KEY` | Server only — never expose to client |
| C3 | `STRIPE_SECRET_KEY` | Must be `sk_live_*` |
| C4 | `STRIPE_WEBHOOK_SECRET` | From **single** Live webhook → `https://www.mmddelivery.com/api/stripe/webhook` |
| C5 | `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | `pk_live_*` |
| C6 | `CRON_SECRET`, `DISPATCH_INTERNAL_SECRET` | Strong random values |
| C7 | `STRIPE_TRANSFERS_ADMIN_SECRET` | Required for payouts |
| C8 | Twilio | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM` |
| C9 | Push | `PUSH_API_KEY` |
| C10 | Mapbox | `NEXT_PUBLIC_MAPBOX_TOKEN`, `MAPBOX_ACCESS_TOKEN` |
| C11 | Health check | `GET /api/health` → 200 |
| C12 | Stripe webhook health | `GET /api/health/stripe-webhook` with `Authorization: Bearer $CRON_SECRET` |
| C13 | Auth policy (optional) | `REQUIRE_EMAIL_VERIFICATION=true` after Supabase email confirm enabled |
| C14 | Transactional SMS/email (optional) | `TRANSACTIONAL_SMS_ENABLED`, `TRANSACTIONAL_EMAIL_ENABLED` — only after Twilio/Resend live |

Full list: `.env.example`

---

## D. External dispatch crons (OPS — production blocker for reliability)

Configure **outside Vercel Hobby daily limit** (cron-job.org, GitHub Actions, or Vercel Pro):

| Endpoint | Suggested interval | Auth |
|----------|-------------------|------|
| `/api/cron/retry-order-dispatch` | Every 2–5 min | `Authorization: Bearer $CRON_SECRET` |
| `/api/cron/retry-taxi-dispatch` | Every 2–5 min | Same |
| `/api/cron/taxi-scheduled-dispatch` | Every 1–5 min | Same |

Then set `EXTERNAL_DISPATCH_CRON_CONFIGURED=true` in local certification env.

See: `docs/production/DISPATCH_CRON_STRATEGY.md`

---

## E. Stripe Live (OPS)

| # | Item |
|---|------|
| E1 | One Live webhook endpoint → Next.js only |
| E2 | Edge `stripe_webhook` returns 410 or disabled |
| E3 | Connect enabled for target countries (GN, SN, US, …) |
| E4 | Founder Live smoke: food + delivery + taxi paid flow |
| E5 | Set `LIVE_PAYMENT_E2E_SIGNOFF_DONE=true` after smoke |

---

## F. Twilio (OPS)

| # | Item |
|---|------|
| F1 | Production credentials on Vercel |
| F2 | Voice/SMS webhooks point to `https://www.mmddelivery.com/api/twilio/*` |
| F3 | Masked call E2E on real device during active trip |
| F4 | US SMS at scale: A2P 10DLC registration (`SMS_A2P_10DLC_US_DONE`) |

---

## G. EAS / mobile stores (OPS)

| # | Item |
|---|------|
| G1 | EAS secrets: Supabase, Mapbox (public + download token), Stripe `pk_live_` |
| G2 | `eas build --profile production` from repo root |
| G3 | `google-play-service-account.json` at repo root (gitignored) for submit |
| G4 | B6 device smoke checklist completed |
| G5 | Universal links tested on device (Apple + Android App Links) |
| G6 | `assetlinks.json` SHA256 matches Play App Signing certificate |
| G7 | Apple Team ID in `apple-app-site-association` |
| G8 | Store listing URLs in Vercel env |

See: `docs/production/B6_STORE_SUBMISSION_DEVICE_SMOKE.md`

---

## H. Mapbox (OPS)

| # | Item |
|---|------|
| H1 | Production token in Vercel + EAS |
| H2 | `RNMAPBOX_MAPS_DOWNLOAD_TOKEN` in EAS for native builds |
| H3 | Driver navigation validated — tag `v1.0.0-nav` |

---

## I. Business scope (intentional defaults)

| Feature | Default | Public launch note |
|---------|---------|-------------------|
| Marketplace live checkout/dispatch/payouts | OFF | Enable only after separate certification |
| AI assistant | OFF | Enable with cost caps + `AI_ASSISTANT_ENABLED` |
| Driver nav Phase B (background GPS analytics) | OFF | Future release |

---

## J. Sign-off matrix

| Milestone | Requires |
|-----------|----------|
| **Merge to main + CI green** | A1–A5 |
| **Controlled pilot (founder ops)** | B1–B7, C1–C12, E1–E5, G1–G2, H1–H3 |
| **Public US launch at scale** | All above + D (crons), F4, G4–G8 |
| **Marketplace revenue** | Separate enablement of marketplace live flags |

---

## Commands reference

```bash
# Local CI equivalent
pnpm test:ci

# Production certification (requires prod env file)
node apps/web/scripts/final-production-certification.mjs --env docs/production/final-certification.env

# Store readiness static checks
node apps/web/scripts/store-submission-readiness.mjs --env docs/production/store-submission.env
```
