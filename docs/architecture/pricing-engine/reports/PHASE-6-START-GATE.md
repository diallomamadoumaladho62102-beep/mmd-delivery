# Phase 6 — Legacy Cleanup — START-GATE

**Date :** 2026-08-03  
**Type :** START-GATE (préparation)  
**Statut :** `APPROUVÉ` (2026-08-03) — fondateur : « Phase 6 — APPROUVÉ »  
**Amont Hard Gate SoT :** [`PHASE-6-HARD-GATE-PROOF.md`](./PHASE-6-HARD-GATE-PROOF.md) — **`GO`**  
**Gouvernance :** START-GATE → Approbation fondateur → Implémentation → Completion → Validation  

**Autorisation :** nettoyage progressif, documenté, vérifiable ; aucune suppression si encore référencé.

---

## 1. Objectif

Retirer définitivement le filet dual-path / legacy / flags / Kill / Shadow **après** validation humaine, une fois le PE SoT hot path observé en production.

## 2. Pré-requis avant APPROUVÉ

1. Hard Gate SoT **GO** (fait).  
2. Observation prod recommandée (fail-open/Kill inutilisés ; incidents prix = 0).  
3. Approbation fondateur explicite : `Phase 6 — APPROUVÉ`.

## 3. Inventaire de suppression (à exécuter seulement après APPROUVÉ)

### 3.1 Entrypoints / modules legacy SoT

| Fichier | Notes |
|---|---|
| `apps/web/src/lib/foodOrderServerPricing.ts` | Garder helpers menu purs si encore partagés, ou déplacer vers PE ports |
| `apps/web/src/lib/deliveryRequestServerPricing.ts` | Idem |
| `apps/web/src/lib/deliveryPricing.ts` | Si plus aucun import |
| `apps/web/src/lib/taxiFinalPrice.ts` | Si PE ride seul |
| `apps/web/src/lib/marketplaceCheckout.ts` | Si `quoteMarketplaceSot` seul |
| Parts de `clientServiceFee.ts` | Si entièrement remplacé par `engine/compute/serviceFee.ts` |

### 3.2 Dual-path / wrappers / métriques cutover

| Fichier / zone | Action |
|---|---|
| `pricingEngine/charge/selectFoodPackageCharge.ts` | Supprimer |
| `pricingEngine/charge/selectRideChargePath.ts` | Supprimer |
| `pricingEngine/charge/selectMarketplaceChargePath.ts` | Supprimer |
| `pricingEngine/engine/adapters/*` (parité) | Supprimer ou réduire |
| `pricingEngine/shadow/**` | Supprimer |
| `pricingEngine/observability/shadowObserve.ts` | Supprimer / alléger |
| `pricingEngine/cutoverMetrics.ts` | Supprimer ou remplacer métriques PE-only |
| `pricingEngine/killSwitch.ts` + branches Kill dans `sot.ts` | Supprimer |
| `pricingEngine/flags.ts` / canary / env `PRICING_ENGINE_*` | Supprimer après retrait Vercel env |
| Tests `phase3/4/5.cutover*`, shadow tests | Adapter / retirer |

### 3.3 Feature Flags / Kill / Shadow (ops)

| Variable Vercel | Action post-code |
|---|---|
| `PRICING_ENGINE_SHADOW` | Retirer |
| `PRICING_ENGINE_SHADOW_SAMPLE_PCT` | Retirer |
| `PRICING_ENGINE_CANARY_PCT` | Retirer |
| `PRICING_ENGINE_SERVICE_*` | Retirer |
| `PRICING_ENGINE_KILL_SWITCH` | Retirer |

### 3.4 Migrations éventuelles

| Item | Note |
|---|---|
| Snapshots `charge_path` historiques | Conserver en lecture ; nouvelles rows = `engine` only |
| `PRICING_ENGINE_MIGRATION_PHASE` → `6` | Bumper après cleanup |
| Docs GOVERNANCE / ROADMAP | Mettre à jour statut Phase 6 VALIDÉ |

## 4. Services concernés

Food · Package · Ride · Marketplace · Quotes · Checkouts · preview mapbox/orders/new · (commissions/settlements = lecture cents PE, pas de delete payout SQL).

## 5. Interdit tant que non APPROUVÉ

- Toute suppression de fichier legacy / flags / Kill / Shadow / wrappers  
- Tout retrait des variables Vercel de filet  

---

**Pour approuver :** réponse fondateur `Phase 6 — APPROUVÉ` (ou équivalent explicite).
