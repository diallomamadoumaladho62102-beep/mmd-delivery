# PHASE-6-HARD-GATE-PROOF — Audit final (post MVP-1 / Pilot / Live)

**Date audit :** 2026-08-03  
**Type :** Audit technique exhaustif — **aucune suppression**, **aucune modification de comportement**  
**Décision audit :** **`NO GO`**  
**Statut preuve :** **NON VALIDÉ** — hard gate **non satisfait**  
**Réf. :** [PHASE-6-START-GATE](./PHASE-6-START-GATE.md) · [FEATURE-FLAGS](../FEATURE-FLAGS.md) · ADR-001  

**Contexte amont :** MVP-1 Pilot clôturé · paiements Stripe Live Food/Package/Taxi signés · Pilot Launch clôturé · MVP-2 Marketplace `NON CLÔTURÉ` (Connect) · US-AT-SCALE `NON CLÔTURÉ`.  
Ces campagnes **ne prouvent pas** un cutover Pricing Engine 100 % : elles valident l’argent Live et l’ops, pas l’élimination du dual-path PE.

---

## Décision synthétique

| Question | Réponse |
|---|---|
| Le nouveau Pricing Engine est-il la **seule** source de calcul en production ? | **NON** |
| Les Feature Flags / Kill Switch / Shadow sont-ils retirables sans impact ? | **NON** |
| Peut-on supprimer le moteur historique (legacy) ? | **NON — rien ne doit être supprimé** |
| Verdict Hard Gate | **`NO GO`** |

---

## 1. Inventaire Feature Flags / Kill Switch / Shadow (toujours nécessaires)

| Variable | Défaut code | Lu dans | Rôle |
|---|---|---|---|
| `PRICING_ENGINE_SHADOW` | `false` | `apps/web/src/lib/pricingEngine/flags.ts` | Active Shadow Compare |
| `PRICING_ENGINE_SHADOW_SAMPLE_PCT` | `100` | `apps/web/src/lib/pricingEngine/shadow/runShadowCompare.ts` | Échantillonnage shadow |
| `PRICING_ENGINE_CANARY_PCT` | `0` | `flags.ts` | % trafic « engine » |
| `PRICING_ENGINE_SERVICE_RIDE` | `false` | `flags.ts` | Cutover Ride |
| `PRICING_ENGINE_SERVICE_FOOD` | `false` | `flags.ts` | Cutover Food |
| `PRICING_ENGINE_SERVICE_PACKAGE` | `false` | `flags.ts` | Cutover Package |
| `PRICING_ENGINE_SERVICE_MARKETPLACE` | `false` | `flags.ts` | Cutover Marketplace |
| `PRICING_ENGINE_KILL_SWITCH` | `false` | `flags.ts` + `killSwitch.ts` | Force **legacy** + coupe shadow |
| `PRICING_ENGINE_MIGRATION_PHASE` | **5** (const) | `phaseGate.ts` | Phase code — **≠** cutover prod |

**Preuve env ops (2026-08-03) :** aucune variable `PRICING_ENGINE_*` trouvée dans `.env.example`, `apps/web/.env.local`, `docs/production/final-certification.env` → **defaults actifs** → `resolveChargePath` sélectionne **`legacy`** pour tous les services (canary 0, service flags off).

**Kill Switch :** `apps/web/src/lib/pricingEngine/killSwitch.ts` — `isKillSwitchActive` / `resolveChargePathForPhase` force `"legacy"`.  
**Shadow :** `schedulePricingShadowCompare` encore branché sur quotes Food / Package / Ride / Marketplace.  
**Fail-open :** `selectFoodChargePath` / `selectPackageChargePath` / `selectRideChargePath` / `selectMarketplaceChargePath` retombent sur legacy si parité ≠ 0¢ ou erreur Engine.

→ Les flags, Kill Switch et Shadow Compare **sont encore nécessaires** au modèle dual-path. **Non retirables** sans refonte + preuves.

---

## 2. Utilisation par verticale — preuves

### 2.1 Ride (Taxi) — **PAS exclusif Engine**

| Point | Preuve |
|---|---|
| Quote | `POST /api/taxi/rides/quote` — `apps/web/app/api/taxi/rides/quote/route.ts` : `calculateTaxiFinalPriceSnapshot` / `snapshotFromQuoteRpc` (**legacy SoT**) puis `selectRideChargePath` + `schedulePricingShadowCompare` |
| Checkout quote | `POST .../create-taxi-quote-checkout-session` — `calculateTaxiFinalPriceSnapshot` puis `selectRideChargePath` |
| Create ride | `POST /api/taxi/rides/create` — `calculateTaxiFinalPriceSnapshot` **sans** `selectRideChargePath` / **sans** import `pricingEngine` |
| Module SoT | `apps/web/src/lib/taxiFinalPrice.ts` |
| Adapter Engine | `pricingEngine/engine/adapters/rideAdapter.ts` — wrappe le snapshot legacy |

**Verdict Ride :** dual-path ; défaut charge = **legacy** ; create ride = **legacy pur**.

### 2.2 Food — **PAS exclusif Engine**

| Point | Preuve |
|---|---|
| Quote | `POST /api/orders/food/quote` — `computeFoodOrderPricing` puis `selectFoodChargePath` + shadow |
| Checkout | `POST .../create-food-quote-checkout-session` — `computeFoodOrderPricing` → `selectFoodChargePath` |
| Create order | `foodOrderService.createFoodOrderServerSide` — `computeFoodOrderPricing` (+ shadow delivery V2) **sans** `selectFoodChargePath` |
| Module SoT | `apps/web/src/lib/foodOrderServerPricing.ts` + `deliveryPricing.ts` |
| Adapter | `foodAdapter.ts` — importe `foodOrderServerPricing` + `computeDeliveryPricing` ; tax/promo/service **capturés depuis legacy** |

**Verdict Food :** dual-path ; défaut charge = **legacy**.

### 2.3 Package — **PAS exclusif Engine**

| Point | Preuve |
|---|---|
| Quote | `POST /api/delivery-requests/quote` — `computeDeliveryRequestPricing` → `selectPackageChargePath` + shadow |
| Checkout | `create-delivery-quote-checkout-session` — Engine **seulement** si `requestType === "package"` ; sinon force `chargePath: "legacy"` (`delivery_ride_out_of_phase3_scope`) |
| Create request | `createDeliveryRequestServerSide` — pricing legacy **sans** sélecteur Engine |
| Module SoT | `deliveryRequestServerPricing.ts` → `deliveryPricing.ts` |

**Verdict Package :** dual-path ; défaut charge = **legacy** ; branche ride-type encore legacy forcée.

### 2.4 Marketplace — **PAS exclusif Engine**

| Point | Preuve |
|---|---|
| Draft / checkout shadow | `computeMarketplaceCheckoutShadow` (`marketplaceCheckout.ts`) puis `selectMarketplaceChargePath` (`marketplaceOrderService.ts`) |
| Live checkout | `marketplaceLiveCheckoutService.ts` → `selectMarketplaceChargePath` |
| API | `app/api/marketplace/checkout/route.ts` |
| Adapter | `marketplaceAdapter.ts` — assemble cents capturés (pas nouveau rate card indépendant) |

**Verdict Marketplace :** dual-path ; défaut charge = **legacy** ; MVP-2 Live Connect par ailleurs `NON CLÔTURÉ`.

---

## 3. Chemins de calcul — matrice demandée

| Chemin | Encore dépendant du legacy ? | Preuve |
|---|---|---|
| **Quotes** | **OUI** | Toutes les routes quote ci-dessus appellent d’abord les modules `*ServerPricing` / `taxiFinalPrice` / `marketplaceCheckout` |
| **Checkout** | **OUI** | Sessions Stripe basées sur totaux issus du capture legacy (+ éventuel label `chargePath`) |
| **Calcul de prix (base)** | **OUI** | `deliveryPricing.computeDeliveryPricing`, `foodOrderServerPricing`, `taxiFinalPrice`, `computeMarketplaceCheckoutShadow` |
| **Taxes** | **OUI** | Capturées depuis résultat legacy puis recopiées dans adapters Engine (`foodAdapter` commentaire : tax/promo/service from legacy capture) |
| **Fees** | **OUI** | Delivery fee / service fee via `deliveryPricing` + captures legacy |
| **Promotions** | **OUI** | Discounts depuis capture legacy dans adapters |
| **Commissions** | **HORS Engine cutover** | `commissionEngine` / RPC / tables `order_commissions` / `taxi_commissions` — **pas** branchés sur `select*ChargePath` (Settlement hors scope Phase 6 cleanup) |
| **Settlement / Payouts** | **HORS Engine cutover** | Crons `taxi-payouts`, `marketplace-payouts`, transfers Stripe — montants ledgers, **pas** le sélecteur PE |

---

## 4. Production — APIs / Crons / Workers

| Surface | Dépend du legacy pour le montant charge ? | Preuve |
|---|---|---|
| APIs quote/checkout Food/Package/Taxi/Marketplace | **OUI** (défaut) | Routes §2 + flags défaut |
| Appels prod avec flags absents | **Charge = legacy** | Aucun `PRICING_ENGINE_*` dans env cert / example → defaults |
| Crons (`app/api/cron/*`) | **Pas de `select*ChargePath`** | Grep cron : 0 import pricingEngine charge ; payouts ≠ PE |
| Workers / Edge money | Edge money paths désactivés (ops) ; pricing charge = Next.js libs legacy/dual | Runbooks prod |
| Mobile | **Aucun** moteur local PE | Prix via APIs web (legacy/dual côté serveur) |

**Preuve absente (bloquante P1/P5) :** aucun décompte prod `charge_path=engine` à 100 % sur fenêtre ≥ 7 jours ; pas de métrique jointe prouvant 0 `charge_path=legacy` hors Kill Switch.

---

## 5. Migration — dual-path / parallel logic

| Mécanisme | Encore présent ? | Fichiers |
|---|---|---|
| Dual-path charge | **OUI** | `selectFoodPackageCharge.ts`, `selectRideChargePath.ts`, `selectMarketplaceChargePath.ts` |
| Fail-open → legacy | **OUI** | mêmes fichiers (`*_parity_fail_open`, `*_engine_error_fail_open`) |
| Kill Switch | **OUI** | `killSwitch.ts` |
| Shadow Compare ADR | **OUI** | `shadow/runShadowCompare.ts`, `shadow/compareQuotes.ts` |
| Shadow delivery V2 (parallèle) | **OUI** | `apps/web/src/lib/deliveryPricingEngine/*` + logs |
| Engine = wrapper legacy | **OUI** | adapters `foodAdapter`, `rideAdapter`, `packageAdapter`, `marketplaceAdapter` |
| Phase code | **5** | `phaseGate.ts` — cleanup Phase 6 **REPORTÉE** |

**Les Feature Flags de migration ne sont PAS « plus nécessaires »** — ils gouvernent encore le dual-path.  
**Le Kill Switch est encore nécessaire** (rollback).  
**Le Shadow Compare est encore dans le code et planifié** sur les quotes.  
**Une logique parallèle Legacy / PE est encore utilisée** (et l’Engine dépend mathématiquement du legacy).

---

## 6. Checklist hard gate P1–P5 (re-évaluation 2026-08-03)

| ID | Condition | Statut | Preuve |
|---|---|---|---|
| **P1** | Food, Package, Ride, Marketplace en **charge Engine** | **ÉCHEC** | Défauts env = legacy ; dual-path ; create taxi/food/DR sans select* |
| **P2** | Aucun appel prod ne dépend du moteur historique pour le montant | **ÉCHEC** | Modules legacy = SoT ; adapters wrappent legacy |
| **P3** | Flags migration retirables sans impact | **ÉCHEC** | Retrait = perte canary/kill/shadow ; charge toujours legacy-first |
| **P4** | Tests régression entièrement réussis **comme preuve Engine-only** | **INSUFFISANT** | Suites phase* PE prouvent dual-path/parity, **pas** delete-ready |
| **P5** | Métriques prod Engine stables 100 % | **ÉCHEC** | Non fournies ; flags cutover non posés en env cert |

---

## 7. Éléments bloquants (pour un futur GO)

| # | Blocage | Fichiers / services | Action requise |
|---|---|---|---|
| B1 | Charge défaut = legacy | `flags.ts`, env prod | Cutover ops : `SERVICE_*=true`, `CANARY_PCT=100`, Kill Switch off — **puis** preuve métriques |
| B2 | Engine non indépendant (wrappers) | `*Adapter.ts`, `deliveryPricing.ts`, `foodOrderServerPricing.ts`, `taxiFinalPrice.ts`, `marketplaceCheckout.ts` | SoT math Engine **sans** appeler les modules historiques (sinon delete impossible) |
| B3 | Fail-open legacy | `select*ChargePath*.ts` | Retirer fail-open seulement après parité prod prouvée |
| B4 | Routes create hors sélecteur | `taxi/rides/create`, food/DR create services | Brancher ou prouver hors scope montant charge |
| B5 | Preview Mapbox / shares hardcodés | `mapbox/compute-distance`, `deliveryPricing` | Aligner ou documenter hors charge Stripe |
| B6 | Shadow ADR + delivery V2 | `shadow/*`, `deliveryPricingEngine/*` | Plan de retrait après cutover |
| B7 | Preuves prod absentes | logs / `pricing_quote_snapshots` / métriques cutover | Fenêtre ≥ 7 j `charge_path=engine` = 100 % |

---

## 8. Ce que cet audit **n’autorise pas**

Conformément à la demande et à la gouvernance ADR :

- **Aucune** suppression du moteur legacy  
- **Aucun** retrait de Feature Flags / Kill Switch / Shadow  
- **Aucune** suppression de services / tables  
- **Aucune** modification de comportement dans cette étape  

---

## 9. Décision formelle

### `NO GO`

Le **PHASE-6-HARD-GATE-PROOF n’est pas satisfait**.

**Interdit :** suppression complète du legacy, des flags de migration, du Kill Switch, du Shadow Compare, nettoyage historique, clôture définitive de la migration PE.

**Plan pour obtenir un GO :** [`PHASE-6-CLOSURE-ROADMAP.md`](./PHASE-6-CLOSURE-ROADMAP.md) — **`APPROUVÉ`** (5B→5C→5D→5E→6). Prochain gate : [`PHASE-5B-START-GATE.md`](./PHASE-5B-START-GATE.md).

**Autorisé ensuite :** uniquement après exécution du plan validé, nouveau rapport avec P1–P5 **démontrés**, validation humaine `PHASE-6-HARD-GATE-PROOF — VALIDÉ`, puis `Phase 6 — APPROUVÉ` selon le START-GATE Phase 6.

---

## 10. Décision humaine attendue

- **`NO GO` confirmé** — maintenir legacy + dual-path (recommandé par cet audit)  
- **`PHASE-6-HARD-GATE-PROOF — VALIDÉ`** — **uniquement** si vous apportez des preuves prod contraires à §6 (non observées ici)

---

## 11. Références code (index)

| Domaine | Chemins |
|---|---|
| Flags / kill | `pricingEngine/flags.ts`, `killSwitch.ts`, `phaseGate.ts` |
| Select charge | `charge/selectFoodPackageCharge.ts`, `selectRideChargePath.ts`, `selectMarketplaceChargePath.ts` |
| Shadow | `shadow/runShadowCompare.ts`, `shadow/compareQuotes.ts` |
| Legacy SoT | `deliveryPricing.ts`, `foodOrderServerPricing.ts`, `deliveryRequestServerPricing.ts`, `taxiFinalPrice.ts`, `marketplaceCheckout.ts` |
| Routes | `app/api/orders/food/quote`, `delivery-requests/quote`, `taxi/rides/quote`, `taxi/rides/create`, `stripe/client/create-*-checkout-session`, `marketplace/checkout` |
| Docs flags | `docs/architecture/pricing-engine/FEATURE-FLAGS.md` |
