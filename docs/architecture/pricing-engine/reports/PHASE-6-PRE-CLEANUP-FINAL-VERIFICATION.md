# Vérification finale pré-suppression Legacy — Hard Gate

**Date :** 2026-08-03  
**Type :** Audit technique exhaustif — **aucune suppression effectuée**  
**Réf. cutover charge :** [`PE-CUTOVER-EXECUTION-REPORT.md`](./PE-CUTOVER-EXECUTION-REPORT.md) (**GO** charge)  
**Décision Hard Gate :** **`NO GO`**  
**Phase 6 Legacy Cleanup :** **NON AUTORISÉE** — dépendances legacy encore actives  

---

## Décision synthétique

| Question du fondateur | Réponse |
|---|---|
| PE est-il le moteur de **charge** en production (canary 100 %) ? | **OUI** (cutover exécuté) |
| PE est-il l’**unique** moteur de calcul (aucune exécution / dépendance legacy) ? | **NON** |
| Le moteur legacy n’est-il plus utilisé par aucun flux ? | **NON** — legacy s’exécute encore sur chaque hot path |
| Le rollback n’est-il plus nécessaire ? | **NON** — Kill Switch / fail-open / flags encore runtime |
| Peut-on préparer / exécuter la suppression Phase 6 ? | **NON — ne rien supprimer** |

**Verdict :** **NO GO** pour Phase 6. La parité mathématique est excellente (520/520 = 100 %), mais le système reste en **dual-path**. Supprimer le legacy casserait immédiatement le fail-open, le shadow, le Kill Switch, et les flux encore forcés legacy.

---

## 1. Preuves de synchronisation (ce qui est OK)

| Preuve | Résultat |
|---|---|
| Parité harness Phase 2 | **520/520**, **100 %**, 0 diff (food/package/ride/marketplace = 130 chacun) |
| Prod flags | `CANARY=100`, `SERVICE_*=true`, `KILL=false`, `SHADOW=true` |
| Readiness (flags ON) | `blockers: []` ; `desiredPath = engine` × 4 |
| Cutover charge | Deploy prod READY, alias `www.mmddelivery.com` |

Cela prouve : **lorsque le sélecteur choisit engine et que la parité tient, les montants PE et legacy sont identiques** sur le corpus de tests.

Cela **ne prouve pas** : PE exclusif, absence d’exécution legacy, ni sécurité à retirer le filet.

---

## 2. Matrice demandée — Ride / Food / Package / Marketplace

Légende :  
- **Charge label** = ce que `select*` retourne quand flags ON + parité OK  
- **Producteur IO** = qui calcule encore taxes/fees/promos/distance **avant** select  
- **Exclusif PE ?** = aucun chemin legacy runtime

| Critère | Ride | Food | Package | Marketplace |
|---|---|---|---|---|
| Calculs **exclusivement** PE | **NON** | **NON** | **NON** | **NON** |
| Quotes identiques (parité test) | **OUI** (130/130) | **OUI** | **OUI** | **OUI** |
| Checkouts identiques (parité + select) | **OUI si** parity OK | **OUI si** | **OUI si** | **OUI si** |
| Taxes identiques | Via capture legacy → PE assemble | Idem | Idem | Idem |
| Frais identiques | Idem | Idem | Idem | Idem |
| Promotions identiques | Capture legacy | Capture legacy | Capture legacy | Capture + risque fail-open si discounts marketing |
| Commissions identiques | Stockées post-quote (pas re-PE) | Snapshot sur **fees legacy** | Payout estimate legacy | Rates + cents stockés |
| Reversements identiques | Hors PE SoT | Hors PE SoT | Hors PE SoT | Hors PE SoT |
| Paiements (Stripe amount) | `select*` total (engine si OK) | Idem | Idem | Idem |
| Écritures comptables | Persist legacy line items + total sélectionné | Idem (`delivery_fee`, `tax`, etc. = legacy) | Idem | Idem |
| Métriques | Dual-path counters | Idem | Idem | Idem |
| Legacy encore exécuté | **OUI** (`calculateTaxiFinalPriceSnapshot` avant select) | **OUI** (`computeFoodOrderPricing`) | **OUI** (`computeDeliveryRequestPricing`) | **OUI** (`computeMarketplaceCheckoutShadow`) |
| Legacy peut encore **gagner** | Fail-open / Kill | Fail-open / Kill | Fail-open / Kill + **DR ride forcé legacy** | Fail-open / Kill |

---

## 3. Dépendances bloquantes (précises)

### D1 — Dual-path obligatoire : legacy **avant** `select*`

| Où | Pourquoi | Comment supprimer proprement |
|---|---|---|
| `foodOrderService.ts` (~L79–100) : `computeFoodOrderPricing` → `selectFoodChargePath` | Contrat cutover : capture IO legacy puis gate parité | Faire produire tax/promo/distance/fee **par PE** (ou IO amont partagé non-legacy), puis appeler PE seul ; retirer `compute*` du hot path |
| `deliveryRequestService.ts` (~L49–93) : idem package | Idem | Idem pour package |
| `taxi/rides/create/route.ts`, `taxi/rides/quote/route.ts`, checkout taxi | `calculateTaxiFinalPriceSnapshot` puis `selectRideChargePath` | PE `computeTaxiFinalPrice` depuis inputs bruts (distance, rate card) sans module legacy |
| `marketplaceOrderService.ts` / `marketplaceLiveCheckoutService.ts` | `computeMarketplaceCheckoutShadow` puis `selectMarketplaceChargePath` | PE checkout totals sans shadow wrapper legacy |
| Commentaire explicite | `selectFoodPackageCharge.ts` L56–57 : *« after legacy pricing is computed »* | Supprimer ce contrat après PE SoT end-to-end |

### D2 — Fail-open vers legacy (runtime)

| Où | Pourquoi | Comment supprimer |
|---|---|---|
| `charge/selectFoodPackageCharge.ts` L92–105, L130–143 | Si parité ≠ 0¢ ou throw → charge = `pricing.totalCents` legacy | Après fenêtre 0 fail-open prod : retirer branches `fail_open_legacy` ; en cas d’erreur engine → **fail hard** (pas legacy) |
| `charge/selectRideChargePath.ts` (même pattern) | Idem | Idem |
| `charge/selectMarketplaceChargePath.ts` (même pattern) | Idem | Idem |

**Conséquence :** tant que fail-open existe, **le rollback legacy est structurellement nécessaire** (montant legacy déjà calculé).

### D3 — Kill Switch + Feature Flags + Shadow

| Où | Pourquoi | Comment supprimer |
|---|---|---|
| `flags.ts`, `killSwitch.ts`, env `PRICING_ENGINE_*` | Cutover / rollback / canary | Après Hard Gate GO + observation : retirer résolution flags ; hardcode path engine |
| `shadow/runShadowCompare.ts` + appels quote | Compare non-charge legacy vs engine | Désactiver puis supprimer après preuves |
| Prod env actuel | `SHADOW=true`, `KILL=false`, canary 100 | Retirer variables Vercel **après** code cleanup |

### D4 — Flux encore **forcés** legacy

| Où | Pourquoi | Comment supprimer |
|---|---|---|
| `deliveryRequestService.ts` L84–91 (`request_type !== "package"`) | DR ride hors scope Phase 3 — `reason: delivery_ride_out_of_phase3_scope` | Brancher sur `selectRideChargePath` / PE ride, ou déprécier le type |
| `create-delivery-quote-checkout-session` (ride DR) | Aligné create forcé legacy | Idem |
| `orders/new/page.tsx`, `mapbox/compute-distance` | Previews purs `computeDeliveryPricing` | Migrer preview vers PE |

### D5 — PE n’est pas SoT sur les composants Food/Package

| Où | Pourquoi | Comment supprimer |
|---|---|---|
| `foodAdapter.ts` L70–75 : total engine assemblé depuis `pricing.tax`, `pricing.deliveryFee`, `pricing.serviceFee`, `subtotalAfterDiscount` | Tax/promo/fee IO restent legacy ; PE recalcule surtout delivery V1 / assemblage | Porter tax/promo/service fee dans `engine/compute/*` ; adapters ne lisent plus le résultat `computeFoodOrderPricing` comme SoT |
| Persist food create L129–166 | `tax`, `delivery_fee`, `delivery_pay`, promos = champs **legacy** même si `total` = sélection | Persister depuis quote PE atomique |

### D6 — Commissions / reversements / compta hors PE

| Où | Pourquoi | Comment supprimer |
|---|---|---|
| `snapshotOrderCommission` / `refresh_order_commissions` (food) | Basés fees/payout legacy | Commission engine lit snapshot PE immutable |
| `marketplacePayoutService` | Rates + cents stockés, pas re-PE | Idem |
| Payouts taxi / delivery | `driver_payout_cents` stockés à la création | Garantir que ces cents viennent du snapshot PE |

### D7 — Preuves prod insuffisantes pour « rollback inutile »

| Manque | Pourquoi bloque |
|---|---|
| Compteurs prod persistés `charge_path=engine` / `failOpen≈0` sur fenêtre | Métriques readiness = **in-process** (0/0 au probe local) — pas de journal prod durable dans ce rapport |
| Smokes Live bout-en-bout quote→pay→commission→reversement | Non exécutés exhaustivement post-cutover |
| `PRICING_ENGINE_MIGRATION_PHASE = 5` | Phase 6 code gate non débloquée (`phaseGate.ts`) |

---

## 4. Conditions Hard Gate non réunies

| Condition « GO cleanup » | État |
|---|---|
| PE unique moteur utilisé en prod | **ÉCHEC** — dual-path |
| Legacy inutilisé par tout flux | **ÉCHEC** — exécuté partout + DR ride forcé |
| Rollback plus nécessaire | **ÉCHEC** — Kill + fail-open |
| Aucune dépendance legacy | **ÉCHEC** — D1–D6 |
| 0 divergence PE vs legacy | **OK en harness** (520/520) ; **non prouvé** 0 fail-open Live durable |

---

## 5. Phase 6 — Legacy Cleanup

**Statut :** **NON préparée pour exécution** (mandat : si une seule dépendance → ne rien supprimer).

Inventaire de suppression **différé** jusqu’à Hard Gate **VALIDÉ** + START-GATE Phase 6 **APPROUVÉ**. Voir feuille de route existante : [`PHASE-6-CLOSURE-ROADMAP.md`](./PHASE-6-CLOSURE-ROADMAP.md).

Ordre propre (rappel, **non exécuté**) :

1. PE SoT end-to-end (tax/promo/fee/distance) — plus de `compute*` avant charge  
2. Brancher DR ride + previews  
3. Observer prod : fail-open ≈ 0, `charge_path=engine`  
4. Retirer fail-open  
5. Retirer Kill / flags / shadow / dual-path `select*`  
6. Supprimer modules legacy + wrappers  
7. Bumper `PRICING_ENGINE_MIGRATION_PHASE` → 6 + preuves Vercel  

---

## 6. Synthèse

```
NO GO — ne supprimer absolument rien.

Le cutover charge (GO) ≠ PE unique moteur.
Parité 100 % (harness) ≠ absence de dépendance legacy.
Le filet (legacy + fail-open + Kill + Shadow) est encore structurel.
```

**Prochaine action autorisée :** combler D1–D7 (indépendance SoT + couverture DR ride + preuves prod fail-open), puis **rejouer** ce Hard Gate. Seulement alors : START-GATE Phase 6 + liste de suppressions.
