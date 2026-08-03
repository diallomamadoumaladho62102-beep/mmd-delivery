# Feature Flags — Pricing Engine

**Statut : RETIRÉ — Phase 6 (2026-08-03)**

Les variables de migration dual-path ne sont plus lues par le code et ont été retirées de `.env.example` et des env Vercel Production / Preview.

| Ancienne variable | Statut |
|---|---|
| `PRICING_ENGINE_SHADOW` | Retirée |
| `PRICING_ENGINE_SHADOW_SAMPLE_PCT` | Retirée |
| `PRICING_ENGINE_CANARY_PCT` | Retirée |
| `PRICING_ENGINE_SERVICE_FOOD` | Retirée |
| `PRICING_ENGINE_SERVICE_PACKAGE` | Retirée |
| `PRICING_ENGINE_SERVICE_RIDE` | Retirée |
| `PRICING_ENGINE_SERVICE_MARKETPLACE` | Retirée |
| `PRICING_ENGINE_KILL_SWITCH` | Retirée |

Charge SoT : Pricing Engine uniquement (`quote*Sot`).  
Voir [`reports/PHASE-6-COMPLETION.md`](./reports/PHASE-6-COMPLETION.md).

Flags produit hors migration PE (ex. `MARKETPLACE_CHECKOUT_ENABLED`) ne sont pas concernés.
