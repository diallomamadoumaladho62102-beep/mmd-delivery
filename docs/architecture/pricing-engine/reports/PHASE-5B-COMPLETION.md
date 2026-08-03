# Rapport de fin — Phase 5B (Independence)

**Date :** 2026-08-03  
**Statut :** `VALIDÉ` (délégation autonome fondateur — enchaînement 5B→5E, 2026-08-03)  
**Gate :** [`PHASE-5B-START-GATE.md`](./PHASE-5B-START-GATE.md) — **`APPROUVÉ AVEC AMENDEMENTS`** (2026-08-03)  
**Amont :** [`PHASE-6-CLOSURE-ROADMAP.md`](./PHASE-6-CLOSURE-ROADMAP.md) — **APPROUVÉ** · Hard Gate — **NO GO** (re-proof 5E)  
**Gouvernance :** START-GATE → Approbation → Implémentation → Completion → Validation (délégation pour 5B–5E)  

---

## 1. Objectif atteint

Faire du **Pricing Engine** la **seule source de vérité de calcul** pour le chemin `engine` des quatre verticales :

| Verticale | Adapter | Compute PE |
|---|---|---|
| **Ride** | `engine/adapters/rideAdapter.ts` | `engine/compute/taxiFinalPrice.ts` |
| **Food** | `engine/adapters/foodAdapter.ts` | `engine/compute/deliveryFeeV1.ts` + `foodPackageTotals.ts` |
| **Package** | `engine/adapters/packageAdapter.ts` | `engine/compute/deliveryFeeV1.ts` + `foodPackageTotals.ts` |
| **Marketplace** | `engine/adapters/marketplaceAdapter.ts` | `engine/compute/marketplaceCheckout.ts` |

Le moteur legacy **reste sur disque** (shadow / fail-open / charge legacy).  
**Aucune** suppression de Feature Flags, Kill Switch, Shadow Compare, wrappers, ou cleanup (réservé Phase 6).

---

## 2. Amendements fondateur — couverture

| Amendement | Statut |
|---|---|
| Engine = seule SoT de calcul (Ride/Food/Package/Marketplace) | **Oui** — chemin engine |
| Pas de suppression legacy / flags / Kill / Shadow / wrappers | **Respecté** |
| Preuve **par verticale** dans ce rapport | **Oui** (§4) |
| Aucun changement comportement / prix / paiements / reversements **prod** | **Oui** — defaults charge = `legacy` |

---

## 3. Travaux réalisés

### 3.1 Modules PE créés (formules indépendantes)

| Fichier | Rôle |
|---|---|
| `engine/compute/money.ts` | `roundMoney2` / cents |
| `engine/compute/deliveryFeeV1.ts` | Fee V1 + split platform/driver |
| `engine/compute/taxiFinalPrice.ts` | Finalisation Ride (discounts / shared) |
| `engine/compute/marketplaceCheckout.ts` | Delivery floor/pct + total |
| `engine/compute/foodPackageTotals.ts` | Assemblage total Food/Package |

### 3.2 Adapters réécrits

| Avant (NO GO P4) | Après 5B |
|---|---|
| Engine ≈ clone capture ; appels legacy pour meta | **Legacy** = normalisation capture (shadow) |
| | **Engine** = montants issus de `pricingEngine/engine/compute/*` |
| Imports `@/lib/deliveryPricing`, `taxiFinalPrice`, etc. | **Interdits** en value-import sur les adapters |

### 3.3 Inchangé (volontairement)

- `resolveChargePath` défaut → **`legacy`**
- Kill Switch, Shadow Compare, fail-open, canary
- Code legacy (`deliveryPricing`, `taxiFinalPrice`, `marketplaceCheckout`, `foodOrderServerPricing`)
- Flags / env prod (aucune activation cutover — → Phase 5D)

---

## 4. Preuves par verticale

### 4.1 Ride

| Critère | Preuve |
|---|---|
| PE = seule SoT (chemin engine) | `buildRideComparablePair` → `computeTaxiFinalPrice` ; `meta.sot = "pricing-engine"` |
| Aucune logique métier legacy sur engine | Pas d’import value `@/lib/taxiFinalPrice` |
| Aucune formule legacy exécutée pour engine | Totaux engine = `peSnap.total_cents` / `total_discount_cents` |
| Résultats = attentes | Fixture 1000+80 → **1080¢** ; shared 15 % → 150 / total 850 ; parité 0¢ vs capture |
| Preuve technique | `phase5b.independence.test.ts` + `phase4.cutover.test.ts` OK |

### 4.2 Food

| Critère | Preuve |
|---|---|
| PE = seule SoT (chemin engine) | `computeDeliveryFeeV1(miles, minutes)` + `assembleFoodPackageCustomerTotalCents` |
| Aucune logique métier legacy sur engine | Pas d’import `@/lib/deliveryPricing` ; type-only `FoodOrderPricingResult` OK |
| Aucune formule legacy exécutée pour engine | Fee V1 PE ; split commission PE ; total assemblé PE |
| Résultats = attentes | Golden 5 mi / 15 min → fee **9.25** / driver **7.40** / total **3103¢** ; parité 0¢ |
| Preuve technique | `phase5b.independence.test.ts` + `phase2.shadow` + `phase3.cutover` OK |

### 4.3 Package

| Critère | Preuve |
|---|---|
| PE = seule SoT (chemin engine) | `splitDeliveryFeeV1` / `computeDeliveryFeeV1` + assemblage PE |
| Aucune logique métier legacy sur engine | Adapter sans import legacy pricing |
| Aucune formule legacy exécutée pour engine | Commission + total via PE |
| Résultats = attentes | Fixture raw 9.25 → driver 7.40 / total **925¢** ; parité 0¢ |
| Preuve technique | `phase5b.independence.test.ts` + `phase3.cutover.test.ts` OK |

### 4.4 Marketplace

| Critère | Preuve |
|---|---|
| PE = seule SoT (chemin engine) | `computeMarketplaceCheckoutTotals` (floor 299 / 8 %) |
| Aucune logique métier legacy sur engine | Pas d’import `@/lib/marketplaceCheckout` |
| Aucune formule legacy exécutée pour engine | Delivery + total recalculés PE |
| Résultats = attentes | subtotal 10000 → delivery **800** / total **10800** ; floor 1000 → **299** ; parité 0¢ |
| Preuve technique | `phase5b.independence.test.ts` + `phase5.cutover.test.ts` OK |

---

## 5. Tests exécutés (2026-08-03)

| Suite | Résultat |
|---|---|
| `phase5b.independence.test.ts` | **OK** |
| `phase1.parity.test.ts` | **OK** |
| `phase2.shadow.test.ts` | **OK** |
| `phase2.killSwitch.test.ts` | **OK** |
| `phase3.cutover.test.ts` | **OK** |
| `phase4.cutover.test.ts` | **OK** |
| `phase5.cutover.test.ts` | **OK** |

Commande :

```bash
pnpm exec tsx src/lib/pricingEngine/phase5b.independence.test.ts
# (+ phase1…phase5 cutover / shadow / kill)
```

---

## 6. Non-régression production

| Garantie | Statut |
|---|---|
| Flags charge défaut = legacy | **Confirmé** (tests) |
| Aucun changement env prod dans cette phase | **Oui** |
| Kill Switch / Shadow / fail-open présents | **Oui** |
| Legacy code non supprimé | **Oui** |
| Prix / paiements / reversements inchangés en prod | **Oui** (trafic reste legacy tant que flags OFF) |

---

## 7. Limites restantes (hors 5B — pour phases suivantes)

| Limite | Phase |
|---|---|
| Routes create / quotes qui **n’appellent pas** encore `select*` | **5C** Surface Coverage |
| Activation progressive prod (canary / métriques ops) | **5D** Production Cutover |
| Nouvel audit Hard Gate P1–P5 | **5E** |
| Suppression legacy / flags / Kill / Shadow | **Phase 6** (après 5E GO) |
| Entrées IO (Mapbox, RPC promo, Admin rates) encore capturées en amont puis passées aux adapters | Accepté en 5B ; couverture surfaces → 5C |

---

## 8. Inventaire fichiers

**Créés**

- `apps/web/src/lib/pricingEngine/engine/compute/money.ts`
- `apps/web/src/lib/pricingEngine/engine/compute/deliveryFeeV1.ts`
- `apps/web/src/lib/pricingEngine/engine/compute/taxiFinalPrice.ts`
- `apps/web/src/lib/pricingEngine/engine/compute/marketplaceCheckout.ts`
- `apps/web/src/lib/pricingEngine/engine/compute/foodPackageTotals.ts`
- `apps/web/src/lib/pricingEngine/phase5b.independence.test.ts`
- `docs/architecture/pricing-engine/reports/PHASE-5B-COMPLETION.md`

**Modifiés**

- `engine/adapters/{food,package,ride,marketplace}Adapter.ts`
- `charge/selectFoodPackageCharge.ts` / `selectRideChargePath.ts` (commentaires)
- `pricingEngine/index.ts` (exports compute)
- `PHASE-5B-START-GATE.md` (approbation + amendements)

---

## 9. Décision

**`Phase 5B — VALIDÉ`** (délégation 2026-08-03) — suite exécutée : 5C → 5D → 5E.

---

*Document de gouvernance — Phase 5B Independence — COMPLETION — 2026-08-03.*
