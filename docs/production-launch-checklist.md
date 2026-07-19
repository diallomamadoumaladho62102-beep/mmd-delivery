# Production launch checklist (DO NOT EXECUTE in Phase 10 / 10.1)

## Phase 10.1 gate (2026-07-19)

Recommendation: **READY FOR PREVIEW** (local empty-DB migrations + SQL tests + prior web/mobile Preview Android green).

Still out of scope / blocked for later Preview ops:

- Vercel Preview deploy (not launched this pass)
- Remote Supabase Preview project (not wired)
- Stripe CLI webhook E2E
- iOS Preview / device smoke

## Before go-live

- [ ] Preview validated (smoke matrix green)
- [ ] Supabase backup / PITR confirmed
- [ ] Migrations reviewed & approved (order, RLS, grants)
- [ ] Secrets Production set (Stripe Live, webhook Live, Supabase, Mapbox, Sentry)
- [ ] Confirm no Test keys on Production; no Live keys on Preview
- [ ] Domains + SSL
- [ ] Crons enabled with `CRON_SECRET`
- [ ] Feature flags for limited geography (Delivery NYC boroughs; Taxi Nassau ≠ NYC)
- [ ] Support + Finance + Ops staffing
- [ ] Rollback plan acknowledged
- [ ] 24h monitoring window planned
- [ ] Incident channel ready

## Explicitly out of Phase 10 / 10.1

- Apply migrations to Production
- Merge to `main` without authorization
- Real charges / refunds / payouts
- Store submission (Play / App Store)
- Phase 11
