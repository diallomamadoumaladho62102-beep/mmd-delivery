# Phase 10 / 10.1 — Bug register

| id | titre | module | sévérité | statut | correction |
|----|-------|--------|----------|--------|------------|
| P10-001 | Marketplace refund n’appelait pas reverse Marketing | marketing | P1 | fixed (code) | `stripeWebhookChargeRefunded` |
| P10-002 | Discount Food/Delivery sans réservation conservé | marketing | P0 | fixed (code) | strip fail-closed |
| P10-003 | Bonus chauffeur: éligibilité trop faible | marketing | P1 | fixed (SQL) | `mmd_marketing_driver_is_eligible` |
| P10-004 | Support voyait finance.read global | rbac | P1 | fixed (code) | lookup-only |
| P10-005 | Finance payloads sans snapshot | finance | P2 | fixed (code) | snapshot enrich |
| P10-006 | Revenue schedules non amortis | finance | P2 | fixed (SQL+cron) | recognize batch |
| P10-007 | Analytics tops/series vides | analytics | P2 | partial | tables + cache read |
| P10-008 | Migration empty/incremental non exécutée | infra | P1 | **fixed (local)** | `supabase db reset` EXIT 0 on local; Preview remote still not wired |
| P10-009 | cancel Food stripeRefund undefined | orders | P0 | fixed | cancel route |
| P10-010 | TypeScript Web bloquant | web | P1 | fixed | adminFetchJson / unions |
| P10-011 | undici 8.x casse Expo/EAS | mobile | P1 | fixed | undici@6.23.0 |
| P10-012 | EAS Android Preview Bundle JS fail | mobile | P1 | fixed | rebuild after reinstall |
| P10-013 | eas.json preview → env EAS « production » | config | P2 | open (doc) | séparer env Preview |
| P10-014 | Baseline tables absentes (profiles/delivery_requests/…) | migrations | P1 | fixed | bootstrap `20251221063221` + defensive historical patches |
| P10-015 | `mmd_loyalty_reverse` bigint→integer cast | loyalty | P1 | fixed | cast + `20260906130000_phase_10_1_loyalty_reverse_cast.sql` |

## Open severity summary (2026-07-19 Phase 10.1)

- **P0 open:** none
- **P1 open (applicatif):** none blocking Preview local path
- **P1 residual env:** Preview Supabase remote not configured (ops), Stripe CLI webhook E2E absent
- **P2 open:** P10-007 partial, P10-013
- **P3 open:** none tracked
