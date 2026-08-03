# Phase 6 — Legacy Cleanup — COMPLETION

**Date :** 2026-08-03  
**Statut :** `COMPLÉTÉE` (code + vérifications locales + retrait env Vercel Preview/Production)  
**Approbation fondateur :** `Phase 6 — APPROUVÉ`  
**Amont :** Hard Gate SoT [`PHASE-6-HARD-GATE-PROOF.md`](./PHASE-6-HARD-GATE-PROOF.md) — **GO** · START-GATE [`PHASE-6-START-GATE.md`](./PHASE-6-START-GATE.md) — **APPROUVÉ**

---

## 1. Validation finale

| Assertion | Résultat |
|---|---|
| Le moteur legacy n’existe plus comme SoT de charge | **Confirmé** — hot paths → `quote*Sot` PE uniquement |
| Le Pricing Engine est l’unique moteur de calcul charge | **Confirmé** — `PRICING_ENGINE_MIGRATION_PHASE = 6` |
| Dual-path / Shadow / Kill / Feature Flags migration retirés | **Confirmé** (code + env Vercel) |
| Migration charge Pricing Engine | **Définitivement terminée** |

SoT PE : `quoteFoodSot` · `quotePackageSot` · `quoteMarketplaceSot` · `quoteRideFinalSot` / `quoteRideFinalFromRateCaptureSot`.

---

## 2. Fichiers supprimés (dual-path / migration)

| Fichier |
|---|
| `apps/web/src/lib/pricingEngine/flags.ts` |
| `apps/web/src/lib/pricingEngine/flagTypes.ts` |
| `apps/web/src/lib/pricingEngine/flags.phase0.test.ts` |
| `apps/web/src/lib/pricingEngine/killSwitch.ts` |
| `apps/web/src/lib/pricingEngine/canary.ts` |
| `apps/web/src/lib/pricingEngine/cutoverMetrics.ts` |
| `apps/web/src/lib/pricingEngine/phase2ParityHarness.ts` |
| `apps/web/src/lib/pricingEngine/charge/selectFoodPackageCharge.ts` |
| `apps/web/src/lib/pricingEngine/charge/selectRideChargePath.ts` |
| `apps/web/src/lib/pricingEngine/charge/selectMarketplaceChargePath.ts` |
| `apps/web/src/lib/pricingEngine/engine/adapters/foodAdapter.ts` |
| `apps/web/src/lib/pricingEngine/engine/adapters/packageAdapter.ts` |
| `apps/web/src/lib/pricingEngine/engine/adapters/rideAdapter.ts` |
| `apps/web/src/lib/pricingEngine/engine/adapters/marketplaceAdapter.ts` |
| `apps/web/src/lib/pricingEngine/shadow/comparableQuote.ts` |
| `apps/web/src/lib/pricingEngine/shadow/compareQuotes.ts` |
| `apps/web/src/lib/pricingEngine/shadow/journal.ts` |
| `apps/web/src/lib/pricingEngine/shadow/metrics.ts` |
| `apps/web/src/lib/pricingEngine/shadow/runShadowCompare.ts` |
| `apps/web/src/lib/pricingEngine/shadow/types.ts` |
| `apps/web/src/lib/pricingEngine/observability/shadowObserve.ts` |
| `apps/web/src/lib/pricingEngine/phase1.parity.test.ts` |
| `apps/web/src/lib/pricingEngine/phase2.killSwitch.test.ts` |
| `apps/web/src/lib/pricingEngine/phase2.shadow.test.ts` |
| `apps/web/src/lib/pricingEngine/phase3.cutover.test.ts` |
| `apps/web/src/lib/pricingEngine/phase4.cutover.test.ts` |
| `apps/web/src/lib/pricingEngine/phase5.cutover.test.ts` |

Types snapshot déplacés (sans Shadow) : `contracts/comparableQuote.ts`.

---

## 3. Composants / symboles retirés

| Composant | Action |
|---|---|
| `selectFoodChargePath` / `selectPackageChargePath` / `selectRideChargePath` / `selectMarketplaceChargePath` | Supprimés |
| Shadow Compare (`runShadowCompare`, `schedulePricingShadowCompare`, journal/metrics) | Supprimés |
| Feature Flags migration (`resolvePricingEngineFlags`, `flags.ts`) | Supprimés |
| Kill Switch (`isKillSwitchActive`, bridge Kill dans `sot.ts`) | Supprimés |
| Canary / cutover metrics / parity harness / adapters parité | Supprimés |
| `computeFoodOrderPricing` | Retiré (fichier réduit aux helpers menu + types) |
| `computeDeliveryRequestPricing` | Retiré (fichier types-only) |
| `calculateTaxiFinalPriceSnapshot` | Retiré (`taxiFinalPrice` = drift/ride-row + PE) |
| `computeMarketplaceCheckoutShadow` | Retiré (types + `MARKETPLACE_CHECKOUT_ENABLED` conservés) |

---

## 4. Feature Flags retirés

| Variable | Code | `.env.example` | Vercel Production | Vercel Preview |
|---|---|---|---|---|
| `PRICING_ENGINE_SHADOW` | retiré | retiré | retiré | retiré |
| `PRICING_ENGINE_SHADOW_SAMPLE_PCT` | retiré | retiré | retiré | retiré |
| `PRICING_ENGINE_CANARY_PCT` | retiré | retiré | retiré | retiré |
| `PRICING_ENGINE_SERVICE_FOOD` | retiré | retiré | retiré | retiré |
| `PRICING_ENGINE_SERVICE_PACKAGE` | retiré | retiré | retiré | retiré |
| `PRICING_ENGINE_SERVICE_RIDE` | retiré | retiré | retiré | retiré |
| `PRICING_ENGINE_SERVICE_MARKETPLACE` | retiré | retiré | retiré | retiré |
| `PRICING_ENGINE_KILL_SWITCH` | retiré | retiré | retiré | retiré |

Doc : [`FEATURE-FLAGS.md`](../FEATURE-FLAGS.md) marqué **RETIRÉ — Phase 6**.

---

## 5. Kill Switch / Shadow Compare

| Item | Statut |
|---|---|
| Kill Switch code + env | **Retiré** |
| Shadow Compare modules + observability | **Retiré** |
| Bridge Kill dans `sot.ts` | **Retiré** (PE-only re-exports) |

---

## 6. Wrappers

| Wrapper | Statut |
|---|---|
| Adapters parité (`foodAdapter` / `packageAdapter` / `rideAdapter` / `marketplaceAdapter`) | **Supprimés** |
| `select*ChargePath` | **Supprimés** |
| `computeDeliveryPricing` | **Conservé** comme thin adapter → `computeDeliveryFeeV1` (helpers share/abnormality encore utilisés) |

---

## 7. Conservé volontairement (justifié)

| Élément | Raison |
|---|---|
| `foodOrderServerPricing` helpers (`loadRestaurantMenuLines`, types résultat) | IO menu partagé par PE `quoteFood` / create / checkout freeze |
| `deliveryRequestServerPricing` types | Contrat freeze package / services |
| `deliveryPricing` helpers (shares, abnormality, metersToMiles) | Admin save, ports PE, mapbox, drivers |
| `taxiFinalPrice` (`snapshotFromRideRow`, drift) | Intégrité create/checkout ride |
| `marketplaceCheckout` type + `MARKETPLACE_CHECKOUT_ENABLED` | Feature produit (pas flag migration PE) |
| `clientServiceFee.ts` | Charge encore référencé ; PE a miroir `engine/compute/serviceFee.ts` |
| `marketplaceDeliveryShadow` / deliveryPricingEngine V2 | Moteur livraison V2 produit (≠ dual-path ADR cutover) ; appelle désormais `computeDeliveryFeeV1` |
| Snapshots DB `charge_path` historiques | Lecture seule ; nouvelles rows = engine |
| `assembleComparableQuoteFromParts` + snapshot store | Persistance optionnelle, plus de compare |

---

## 8. Migrations

Aucune migration SQL requise pour le cleanup.  
`PRICING_ENGINE_ALGORITHM_SEMVER` → `6.0.0`.  
`PRICING_ENGINE_MIGRATION_PHASE` → `6`.

---

## 9. Résultats des tests

| Suite | Résultat |
|---|---|
| `phase5f.sotHotPathGate.test.ts` | **OK** (15 hot paths, 10 deleted paths, 4 legacy exports) |
| `phase5b.independence.test.ts` | **OK** (phase 6, delivery/taxi/marketplace compute) |
| `deliveryPricing.test.ts` + `adminPricingSave.test.ts` | **OK** |
| `marketplaceCheckout.test.ts` | **OK** |
| `clientServiceFee.test.ts` | **OK** |
| `marketplaceDeliveryShadow.test.ts` | **OK** |
| `taxiGlobalizationP0.test.ts` | **OK** |
| `foodOrderTrustBoundary.test.ts` | **OK** |
| `taxiInternationalFinalization.test.ts` | **OK** |
| `tsc --noEmit` (apps/web) | **OK** |

Périmètre couvert : Quotes / Checkouts (chemins PE) · Paiements (trust/Stripe helpers) · Taxes/Promos/Fees via PE orchestrators · Commissions/reversements non touchés (hors moteur calcul charge).

---

## 10. Confirmation

**Le Pricing Engine est désormais l’unique moteur de calcul de charge de MMD Delivery.**  
La migration dual-path (legacy ↔ engine) est **terminée**.

## 11. Finalisation ops (post-COMPLETION)

Voir [`PHASE-6-MIGRATION-FINAL-CLOSURE.md`](./PHASE-6-MIGRATION-FINAL-CLOSURE.md) :

- Commit `f49a2400` poussé sur `cursor/pe-phase-5b-independence`
- Preview `dpl_8epiPfGtHGtJEJQepLxU4q6UUGvy` + Production `dpl_GENV2yDJGVWRanp55DvCrRNJjGmV` (alias www)
- Env `PRICING_ENGINE_*` absentes Preview/Production
- Smoke Live Quote→Checkout OK ; paiements Live validés (merged_pass)
