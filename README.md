# MMD Delivery — Monorepo (Next.js + Expo + Supabase)

Production site: https://www.mmddelivery.com

## Stack

| Layer | Technology |
|-------|------------|
| Web | Next.js 16 (`apps/web`) — Vercel |
| Mobile | Expo 54 (`apps/mobile`) — EAS Build |
| Database / Auth | Supabase (Postgres + RLS) |
| Payments | Stripe Live (single Next.js webhook) |
| Maps | Mapbox |
| Calls / SMS | Twilio |

## Quick start (development)

```bash
pnpm install
cp .env.example .env
# Also: apps/web/.env.local and apps/mobile/.env with the same public keys

# Apply Supabase migrations (requires Supabase CLI)
supabase link --project-ref YOUR_REF
supabase db push

# Web
cd apps/web && pnpm dev

# Mobile (from repo root — canonical app.config.ts)
cd apps/mobile && pnpm start
```

## CI (GitHub Actions)

On every push/PR to `main`:

```bash
pnpm test:ci
```

Runs: migration file check, **ESLint** (web `src/lib` + `app/api`, mobile `src/lib`), web build, trust boundary tests, platform guards, store-readiness static checks, mobile navigation tests.

## Production deployment

### Web (Vercel)

- Root directory: repository root (uses `vercel.json`)
- Required env: see `.env.example` (full list)
- Crons in Vercel (daily): payouts, expire-unpaid, taxi monitoring
- **External crons required** for dispatch retry (every 2–5 min) — see `docs/production/DISPATCH_CRON_STRATEGY.md`

### Mobile (EAS)

Run from **repository root** (not `apps/mobile` alone):

```bash
eas build --profile production --platform all
eas submit --profile production
```

EAS secrets required: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_STRIPE_PK` (pk_live_), `EXPO_PUBLIC_MAPBOX_TOKEN`, `RNMAPBOX_MAPS_DOWNLOAD_TOKEN`.

### Supabase

```bash
supabase db push
```

Then run `docs/production/sql/final_certification_checks.sql` on production.

Edge secrets (Supabase dashboard):

- `MMD_STRIPE_WEBHOOK_DISABLED=true`
- `MMD_EDGE_PAYOUTS_DISABLED=true`

## Production checklists

| Document | Purpose |
|----------|---------|
| `docs/production/PUBLIC_LAUNCH_OPS_CHECKLIST.md` | **Master ops checklist** before public launch |
| `docs/production/READINESS_100_CHECKLIST.md` | Vercel env + Live smoke |
| `docs/production/FINAL_PRODUCTION_CERTIFICATION_RUNBOOK.md` | Full certification |
| `docs/production/EXTERNAL_OPS_MANUAL.md` | Crons, Edge, Connect countries |
| `docs/production/store-submission.env.example` | Store / device sign-offs |

## Driver navigation

Tagged release: `v1.0.0-nav`. Tests: `cd apps/mobile && npm run test:navigation`.

## Security

- Never commit `.env`, service role keys, Stripe secrets, or Play service account JSON.
- QA screenshots live in `docs/screenshots/` (gitignored).
- Certification reports in `docs/production/reports/` (gitignored).
