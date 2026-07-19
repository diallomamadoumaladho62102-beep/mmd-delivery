# Phase 10 — System inventory

**Date:** 2026-07-18  
**Branch observed:** `feat/unified-loyalty`  
**Scope:** factual inventory; presence ≠ validated behavior.

## Monorepo structure

| Path | Role |
|------|------|
| `apps/web` | Next.js admin + APIs + partner portals |
| `apps/mobile` | Expo / React Native client + driver apps |
| `android/` | Native Android project (Expo prebuild artifacts) |
| `supabase/migrations` | Ordered SQL migrations |
| `supabase/tests` | SQL smoke checklists |
| `scripts/` | Root verification / audit scripts |
| `docs/` | Ops and production docs |
| `.github/workflows` | CI (ci, codeql, crons, road-safety) |

## Runtime versions (observed via WSL Ubuntu)

| Tool | Version |
|------|---------|
| Node | v20.20.2 |
| pnpm | 10.33.0 |
| Expo (package) | ~54.0.36 |
| React Native | 0.81.5 |
| Next.js | 16.2.6 |
| TypeScript (web) | 5.6.2 |
| TypeScript (mobile) | ~5.9.3 |
| Stripe SDK (web) | 14.25.0 |
| Supabase CLI (npx) | 2.109.1 (Docker daemon unavailable in WSL → local DB blocked) |
| EAS CLI | ~18.5 (upgrade notice to 21.0.2); Android Preview builds succeeded 2026-07-18 |
| Stripe CLI | absent |
| Docker in WSL | absent / Desktop integration not active |

## Applications

- **Web:** `apps/web` — App Router, Admin (`/admin/*`), Stripe webhooks, crons under `/api/cron/*`
- **Mobile:** `apps/mobile` — Expo 54, Mapbox, Sentry, Stripe RN, multi-role navigation

## Data / finance / marketing / analytics (recent)

| Area | Migrations (examples) |
|------|------------------------|
| Loyalty | `20260827120000` … `20260829120500` |
| Marketing | `20260902120000` … `20260903120000` |
| Analytics | `20260904120000` |
| Finance | `20260905120000`, `20260905120500` |
| Phase 10 | `20260906120000_phase_10_stabilization.sql` |

## Crons (vercel.json root + apps/web)

Includes payouts, loyalty/marketing expiry, analytics refresh, finance process, **recognize-finance-revenue** (`35 * * * *`).

## Env vars (names only — no secrets)

Priority: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`, Mapbox tokens, Sentry DSN/auth, `CRON_SECRET`, Twilio/email/push providers, Expo project id.

## CI workflows

- `.github/workflows/ci.yml`
- `codeql.yml`
- production cron dispatch / retention
- road-safety ingest

## Notes

- Inventory does **not** claim Production readiness.
- Mobile builds must run from WSL: `/mnt/c/DEV/MMD-Delivery`.
