# PHASE-6-HARD-GATE-PROOF — Post Phase 5F SoT Hot Path

**Date audit :** 2026-08-03  
**Type :** Audit technique exhaustif — **aucune suppression** legacy / flags / Kill / Shadow  
**Décision audit :** **`GO`** (SoT hot path / lancement public PE)  
**Statut preuve :** **VALIDÉ** pour critères SoT hot path ci-dessous  
**Amont :** [`PHASE-5F-SOT-HOT-PATH-COMPLETION.md`](./PHASE-5F-SOT-HOT-PATH-COMPLETION.md) · [`PE-CUTOVER-EXECUTION-REPORT.md`](./PE-CUTOVER-EXECUTION-REPORT.md)  

**Phase 6 Legacy Cleanup :** **NON EXÉCUTÉE** — START-GATE cleanup à préparer séparément (autorisation fondateur requise pour suppressions).

---

## Décision synthétique

| Question | Réponse |
|---|---|
| Le Pricing Engine est-il l’**unique moteur de calcul** sur les hot paths (Kill OFF) ? | **OUI** |
| Le moteur legacy TS est-il encore **exécuté** sur quote/checkout/create/validate/preview ? | **NON** (Kill OFF) |
| Dual-path `select*` / fail-open utilisés sur hot path ? | **NON** |
| Flags / Kill / Shadow / wrappers / legacy encore **dans le dépôt** (filet) ? | **OUI** (intentionnel) |
| Peut-on **supprimer** le legacy maintenant ? | **NON** — attendre START-GATE Phase 6 + approbation |
| Verdict Hard Gate SoT | **`GO`** |

---

## 1. Critères Hard Gate — preuves

| Critère | Preuve | État |
|---|---|---|
| Hot path n’importe plus `computeFoodOrderPricing` / `computeDeliveryRequestPricing` / `computeDeliveryPricing` / `calculateTaxiFinalPriceSnapshot` / `computeMarketplaceCheckoutShadow` | `phase5f.sotHotPathGate.test.ts` — 15 fichiers | **OK** |
| Hot path n’importe plus `select*ChargePath` / `schedulePricingShadowCompare` | même gate | **OK** |
| Quotes / checkouts / totals via `quote*Sot` / PE orchestrators | Food/Package/Ride/Marketplace branchés | **OK** |
| Materialize sans re-price | `frozen_pricing` Food + Package intents | **OK** |
| Commissions / payouts depuis cents persistés PE | `delivery_pay` / totals / driver cents écrits à create depuis snapshot PE | **OK** |
| Parité formules | Harness 520/520 = 100 % | **OK** |
| Legacy + dual-path + Kill + Shadow encore sur disque | gate vérifie présence `computeFoodOrderPricing` + `selectFoodChargePath` | **OK** |
| Kill OFF en prod (cutover) | Env Production `PRICING_ENGINE_KILL_SWITCH=false` (cutover) | **OK** |

---

## 2. Matrice verticale (Kill OFF)

| Surface | Producteur hot path | Legacy exécuté ? | Dual-path ? |
|---|---|---|---|
| Food quote/checkout/create/validate | `quoteFoodSot` → `quoteFoodWithPricingEngine` | Non | Non |
| Package (+ DR ride-type) | `quotePackageSot` | Non | Non |
| Ride final net | `quoteRideFinalSot` / `FromRateCaptureSot` | Non | Non |
| Marketplace | `quoteMarketplaceSot` | Non | Non |
| Preview mapbox / orders/new | `computeDeliveryFeeV1` (PE) | Non | Non |

### Ports IO (autorisés — pas le moteur legacy TS)

| Port | Rôle |
|---|---|
| Mapbox / geoTrust | Distance / ETA |
| `pricing_config` / taxes DB | Config + taux |
| RPC `compute_order_pricing` | Promo eligibility SQL |
| Marketing / MMD+ resolvers | Remises |
| RPC `quote_taxi_ride` | Rate card taxi (base fare) — PE assemble le net |

---

## 3. Filet conservé (non utilisé sur hot path nominal)

| Mécanisme | Statut |
|---|---|
| `computeFoodOrderPricing` etc. | Présent — appelé **uniquement** si Kill ON via `sot.ts` bridge |
| `select*ChargePath` + fail-open | Présent — **hors** hot path |
| Shadow Compare | Présent — **hors** hot path |
| Feature Flags | Présents |
| Kill Switch | Présent — OFF en prod |

---

## 4. Anomalies / résidus documentés (non bloquants GO SoT)

1. **Rate card taxi** reste SQL (`quote_taxi_ride`) — port, pas legacy TS `calculate*`.  
2. **Promo** via RPC SQL — port.  
3. **Dispatch marketplace** peut encore appeler `buildMarketplaceDeliveryShadowForOrder` (V2) si cents manquants — hors entrypoints legacy listés ; payouts préfèrent cents stockés.  
4. **Phase code** `PRICING_ENGINE_MIGRATION_PHASE` encore `5` jusqu’à cleanup Phase 6.

---

## 5. Décision après Hard Gate

```
GO  → PE est l’unique moteur de calcul sur les hot paths (Kill OFF).
      START-GATE Phase 6 Legacy Cleanup peut être préparé (liste de suppressions).
NO GO cleanup → aucune suppression tant que START-GATE Phase 6 non APPROUVÉ.
```
