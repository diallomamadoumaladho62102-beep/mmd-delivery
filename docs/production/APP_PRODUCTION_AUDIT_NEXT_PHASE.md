# Production application audit — next phase seed

**Date (UTC):** 2026-07-14  
**Scope:** Full-repo audit after Infrastructure / Crons / Paiements / Supabase closure  
**Constraint:** Do not regress Stripe, Supabase trust, Auth, payments integrity, crons, notifications security

## Modules inspected

| Module | Depth | Verdict |
|---|---|---|
| Taxi (mobile + APIs + Mapbox) | Deep | Backend/nav strong; client tracking & multi-stop UX incomplete |
| Marketplace | Deep | Shadow/inventory only; live money intentionally gated |
| Delivery food + package | Deep | Backend strong; package map / live ETA weak |
| Restaurant / dispatch / driver | Deep | Code-complete; external crons + device smoke ops-gated |
| Mobile Expo / EAS / stores | Deep | Build config ready; device/store process open; location plugin drift |
| Admin / web | Spot | Present for ops; consumer taxi web absent (by design) |
| Edge Functions | Spot | Legacy helpers; money edges stay disabled by design |
| CI/CD | Spot | Typecheck/lint/web tests; no EAS submit in CI |

## Problems found (ranked, evidence-based)

### P0 product (safe to fix in batch)

1. Taxi client tracking has no live driver marker (`TaxiRideTrackingScreen`)
2. Taxi multi-stop creates ride before payment (orphan `quoted` risk)
3. TaxiQuote does not forward `stops` into create
4. Taxi home lacks one-tap GPS auto-pickup
5. Driver taxi offers show after `expires_at` without countdown
6. `app.config.ts` missing `expo-location` Android background/FGS plugin flags (drift vs `apps/mobile/app.json`)

### P1 product (separate or follow-up)

7. Package delivery details lack Mapbox map (food has it)
8. Client food/DR screens do not show live remaining ETA
9. Mapbox Places autocomplete + reverse-geocode productization for taxi addresses
10. Opaque quote id + TTL immutability (financial-surface → dedicated PR)

### P2 deferred / multi-day

11. Round-trip taxi product (new pricing/routing)
12. Marketplace seller Connect + live payouts + refunds (financial)
13. Live marketplace checkout enablement
14. Store B6 device smoke, Play/App Store submission process
15. US SMS A2P / transactional outbound
16. External dispatch cron ops confirmation in staging/prod GH

## Intentional non-changes this phase

- No Supabase project config
- No payment settlement / Stripe amount logic
- No cron timeout/lock redesign
- No marketplace live flags
- No taxi payout live flip

## Batch planned after audit

**PR / commit theme:** Taxi client production UX + mobile location native config sync  
(Files under mobile taxi screens, DriverTaxiPanel, AppNavigator, app.config.ts)

Follow-ups documented in global closure report after implementation.
