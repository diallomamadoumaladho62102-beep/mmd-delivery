# Phase 6 — Feuille de route de clôture (post NO GO)

**Date :** 2026-08-03  
**Type :** Analyse + plan — **aucune implémentation dans ce document**  
**Statut :** `APPROUVÉ` (2026-08-03)  
**Décision amont :** [`PHASE-6-HARD-GATE-PROOF.md`](./PHASE-6-HARD-GATE-PROOF.md) — **`NO GO`**  
**Réf. :** [`PHASE-6-START-GATE.md`](./PHASE-6-START-GATE.md) (REPORTÉ) · [`FEATURE-FLAGS.md`](../FEATURE-FLAGS.md) · ADR-001  
**Prochain gate :** [`PHASE-5B-START-GATE.md`](./PHASE-5B-START-GATE.md) — Independence  

**Gouvernance :** START-GATE → Approbation → Implémentation → Completion → Validation (par phase ; validation humaine obligatoire).

---

## Synthèse exécutive

| Élément | État |
|---|---|
| Phase code actuelle | **5** (`PRICING_ENGINE_MIGRATION_PHASE = 5`) |
| Hard Gate Phase 6 | **NON satisfait** (`NO GO`) |
| Charge prod (défaut) | `charge_path = legacy` |
| Engine actuel | **Wrappers de parité** autour des modules historiques + dual-path / fail-open |
| Suppressions | **Interdites** jusqu’à Hard Gate **VALIDÉ** puis `Phase 6 — APPROUVÉ` |
| Phases restantes avant clôture définitive | **5** (détail §8) |

---

# Partie 1 — Analyse des causes du NO GO

Pour chaque point bloquant du Hard Gate Proof :

### N1 — Ride / Food / Package / Marketplace ne sont pas « Engine exclusif »

| | |
|---|---|
| **Pourquoi ça existe** | Migration ADR-001 conçue en dual-path : legacy calcule d’abord, puis `select*ChargePath` décide du label / snapshot. |
| **Pourquoi legacy** | Modules `taxiFinalPrice`, `foodOrderServerPricing`, `deliveryRequestServerPricing`, `marketplaceCheckout` restent la SoT math. |
| **Pourquoi pas Engine seul** | Les adapters (`*Adapter.ts`) **réutilisent** les cents / formules legacy ; ce n’est pas un rate card indépendant. |
| **Risque actuel** | Confusion ops (« Phase 5 clôturée » ≠ Engine-only prod) ; delete legacy casserait immédiatement les quotes. |
| **Solution finale** | Rendre le pipeline Engine **SoT** (Rate/Fee/Tax/Promo assemblés sans appeler les modules historiques), puis basculer charge 100 % engine, puis retirer legacy. |

### N2 — Quotes / Checkout / prix / taxes / fees / promos encore legacy

| | |
|---|---|
| **Pourquoi** | Chaque route charge appelle d’abord `compute*` / `calculateTaxi*` / `computeMarketplaceCheckoutShadow`. |
| **Pourquoi legacy** | Ces fonctions **sont** le moteur historique (ou son encapsulateur marketplace). |
| **Pourquoi Engine non seul** | `select*ChargePath` ne remplace le total que si flags+canary+parité 0¢ ; défaut = renvoyer le total legacy. |
| **Risque** | Stripe Checkout = montants legacy ; shadow/compare ne change pas la charge. |
| **Solution** | Engine produit le total charge **avant** réponse quote/checkout ; legacy absent du hot path. |

### N3 — Flags / Kill Switch / Shadow encore nécessaires

| | |
|---|---|
| **Pourquoi** | Outils de cutover / rollback / confiance pendant la migration. |
| **Pourquoi legacy** | Kill Switch et défauts forcent legacy ; Shadow compare legacy vs engine. |
| **Pourquoi Engine non seul** | Sans flags à 100 % engine + stabilité, le dual-path reste le filet de sécurité. |
| **Risque** | Retrait prématuré = perte de rollback et d’observabilité. |
| **Solution** | Après preuve prod Engine-only stable → START-GATE Phase 6 cleanup retire flags/shadow/dual-path **dans l’ordre**. |

### N4 — Fail-open vers legacy

| | |
|---|---|
| **Pourquoi** | Sécurité cutover : si Engine ≠ legacy d’1¢ ou throw → client paie legacy. |
| **Pourquoi legacy** | Fail-open **exige** un montant legacy déjà calculé. |
| **Pourquoi Engine non seul** | Tant que fail-open existe, legacy est **runtime-obligatoire**. |
| **Risque** | Masque les divergences Engine en prod. |
| **Solution** | Après canary 100 % + 0 fail-open sur fenêtre W → retirer fail-open (phase dédiée). |

### N5 — Routes create hors sélecteur Engine

| | |
|---|---|
| **Pourquoi** | Cutover Phase 3–5 a priorisé quote/checkout ; create ride/order/DR recalcule encore via legacy. |
| **Pourquoi legacy** | `taxi/rides/create`, `foodOrderService` create, `deliveryRequest` create appellent `calculateTaxiFinalPriceSnapshot` / `compute*Pricing` sans `select*`. |
| **Risque** | Montant post-pay / persistance peut diverger du path checkout si on croit Engine-only. |
| **Solution** | Brancher create sur le même SoT Engine (snapshot immuable préféré : rejouer snapshot checkout, pas recalcul legacy). |

### N6 — Preuves prod absentes (`charge_path=engine` ≠ 100 %)

| | |
|---|---|
| **Pourquoi** | Aucun `PRICING_ENGINE_*` dans env cert / example → defaults canary 0 / SERVICE off. |
| **Pourquoi legacy** | `resolveChargePath` → `"legacy"`. |
| **Risque** | Activer 100 % sans observabilité = incident prix. |
| **Solution** | Cutover ops progressif staging→prod + métriques `cutoverMetrics` / snapshots / logs. |

### N7 — Settlement / commissions hors PE (clarification)

| | |
|---|---|
| **Pourquoi** | ADR : Settlement Engine ≠ cutover charge Phase 6. |
| **Dépendance legacy charge ?** | **Non directement** — crons payouts / `commissionEngine` ne passent pas par `select*ChargePath`. |
| **Risque confusion** | Mélanger cleanup payouts et cleanup charge. |
| **Solution finale Phase 6** | **Ne pas** exiger Settlement Engine-only pour le GO charge ; documenter hors scope (sauf si audit ultérieur dédié). |

---

# Partie 2 — Inventaire des usages legacy (charge & dual-path)

> Légende rôle : **SoT** = calcule le montant · **Select** = dual-path · **Shadow** = compare non-charge · **Wrap** = adapter Engine · **Config** = defaults partagés (à conserver).

## 2.1 Modules legacy / historiques (SoT)

| Module fichier | Fonctions clés | Rôle actuel | Équivalent Engine | Reste à migrer |
|---|---|---|---|---|
| `apps/web/src/lib/deliveryPricing.ts` | `computeDeliveryPricing`, shares driver/platform | SoT delivery fee Food/Package | Fee/Rate path Engine + business defaults | Déplacer formules dans Engine ; retirer appels directs charge |
| `apps/web/src/lib/foodOrderServerPricing.ts` | `computeFoodOrderPricing` | SoT Food quote/checkout/create | `foodAdapter` / assembleQuote (aujourd’hui wrap) | SoT Engine autonome |
| `apps/web/src/lib/deliveryRequestServerPricing.ts` | `computeDeliveryRequestPricing` | SoT Package (+ ride-type DR) | `packageAdapter` | Idem + clarifier `request_type=ride` |
| `apps/web/src/lib/taxiFinalPrice.ts` | `calculateTaxiFinalPriceSnapshot`, `snapshotFromQuoteRpc`, `snapshotFromRideRow` | SoT Ride | `rideAdapter` | SoT Engine + snapshots |
| `apps/web/src/lib/marketplaceCheckout.ts` | `computeMarketplaceCheckoutShadow` | SoT totaux marketplace | `marketplaceAdapter` | SoT Engine marketplace |

## 2.2 Dual-path / selecteurs Engine

| Fichier | Fonction | Services | Rôle |
|---|---|---|---|
| `pricingEngine/flags.ts` | `resolvePricingEngineFlags`, `resolveChargePath` | tous | Lit env → path |
| `pricingEngine/killSwitch.ts` | `resolveChargePathForPhase`, `isKillSwitchActive`, `isShadowCompareAllowed` | tous | Kill + phase gate + canary |
| `pricingEngine/canary.ts` | `isInCanaryBucket` | tous | Canary déterministe |
| `pricingEngine/charge/selectFoodPackageCharge.ts` | `selectFoodChargePath`, `selectPackageChargePath` | food, package | Dual + fail-open |
| `pricingEngine/charge/selectRideChargePath.ts` | `selectRideChargePath` | ride | Dual + fail-open |
| `pricingEngine/charge/selectMarketplaceChargePath.ts` | `selectMarketplaceChargePath` | marketplace | Dual + fail-open |
| `pricingEngine/cutoverMetrics.ts` | `recordCutoverSelection` | tous | Métriques path |

## 2.3 Adapters (wrappers legacy)

| Fichier | Wrappe | Rôle |
|---|---|---|
| `engine/adapters/foodAdapter.ts` | `foodOrderServerPricing` + `computeDeliveryPricing` | Parité / « engine » label |
| `engine/adapters/packageAdapter.ts` | capture package | Parité |
| `engine/adapters/rideAdapter.ts` | `calculateTaxiFinalPriceSnapshot` | Parité |
| `engine/adapters/marketplaceAdapter.ts` | cents marketplace | Parité |
| `engine/assembleQuote.ts` | assemblage ComparableQuote | Pipeline Engine |

## 2.4 Shadow ADR + Shadow delivery V2

| Fichier | Rôle |
|---|---|
| `pricingEngine/shadow/runShadowCompare.ts` | Planifie compare async |
| `pricingEngine/shadow/compareQuotes.ts` | Diff ¢ |
| `pricingEngine/observability/shadowObserve.ts` | Logs décision |
| `deliveryPricingEngine/*` | Shadow V2 delivery **non charge** (parallèle ADR) |

## 2.5 APIs / routes (hot path charge)

| Service | Route / API | Fichier route | Appel legacy | Select Engine |
|---|---|---|---|---|
| Food | `POST /api/orders/food/quote` | `app/api/orders/food/quote/route.ts` | `computeFoodOrderPricing` (via service) | `selectFoodChargePath` + shadow |
| Food | `POST /api/stripe/client/create-food-quote-checkout-session` | `.../create-food-quote-checkout-session/route.ts` | `computeFoodOrderPricing` | `selectFoodChargePath` |
| Food | Create order (lib) | `foodOrderService.ts` | `computeFoodOrderPricing` | **Absent** |
| Package | `POST /api/delivery-requests/quote` | `app/api/delivery-requests/quote/route.ts` | `computeDeliveryRequestPricing` | `selectPackageChargePath` + shadow |
| Package | `POST .../create-delivery-quote-checkout-session` | `.../create-delivery-quote-checkout-session/route.ts` | `computeDeliveryRequestPricing` | `selectPackageChargePath` si package ; sinon legacy forcé |
| Package | Create DR (lib) | delivery request service | `computeDeliveryRequestPricing` | **Absent** |
| Ride | `POST /api/taxi/rides/quote` | `app/api/taxi/rides/quote/route.ts` | `taxiFinalPrice` / RPC | `selectRideChargePath` + shadow |
| Ride | `POST .../create-taxi-quote-checkout-session` | `.../create-taxi-quote-checkout-session/route.ts` | `calculateTaxiFinalPriceSnapshot` | `selectRideChargePath` |
| Ride | `POST /api/taxi/rides/create` | `app/api/taxi/rides/create/route.ts` | `calculateTaxiFinalPriceSnapshot` | **Absent** |
| Ride | Checkout ride existant | `create-taxi-checkout-session` | `snapshotFromRideRow` | selon implémentation locale |
| Marketplace | draft / checkout APIs | `marketplaceOrderService.ts`, `marketplaceLiveCheckoutService.ts`, `app/api/marketplace/checkout/*` | `computeMarketplaceCheckoutShadow` | `selectMarketplaceChargePath` + shadow |

## 2.6 Preview / hors charge Stripe (drift)

| Surface | Fichier | Rôle legacy |
|---|---|---|
| Mapbox compute-distance | `app/api/mapbox/compute-distance` (via `computeDeliveryPricing`) | Preview client ; shares parfois hardcodés |
| Mobile | aucun PE local | Consomme APIs web (legacy/dual serveur) |

## 2.7 Crons / workers

| Surface | Dépend `select*ChargePath` ? | Note |
|---|---|---|
| `app/api/cron/*` (payouts, dispatch, etc.) | **Non** | Settlement / ops — hors cutover charge |
| Edge money | Désactivé ops | Ne pas réactiver comme SoT prix |

## 2.8 Config partagée (à **conserver**, pas « legacy delete »)

| Fichier | Usage |
|---|---|
| `pricingEngine/config/businessDefaults.ts` | Tips, wait timer, loyalty, wallet, defaults delivery — **SoT config** post-migration |

---

# Partie 3 — Plan de migration final (étapes)

> Chaque étape future exigera son **START-GATE** dédié avant implémentation.

### Étape M1 — Independence Engine (SoT réel)

| | |
|---|---|
| **Objectif** | Calcul Engine sans appeler `foodOrderServerPricing` / `deliveryPricing` / `taxiFinalPrice` / `marketplaceCheckout` comme SoT |
| **Fichiers** | `engine/adapters/*`, nouveaux modules Rate/Fee/Tax/Promo Engine, éventuellement ports depuis legacy |
| **Composants** | assembleQuote, rate cards, business defaults |
| **Risques** | Divergence ¢ vs legacy ; régression Live |
| **Rollback** | Garder dual-path + Kill Switch ; flags SERVICE off |
| **Validation** | Parity golden 0¢ sur corpus ; tests phase* ; shadow 100 % staging |

### Étape M2 — Couverture surfaces charge

| | |
|---|---|
| **Objectif** | Quote, checkout, **create** (taxi/food/DR), marketplace live : même SoT Engine ; snapshot immuable post-checkout |
| **Fichiers** | routes §2.5, `foodOrderService`, taxi create, delivery create, marketplace services |
| **Risques** | Orphan amounts ; double calcul |
| **Rollback** | Feature flag par surface ou Kill Switch |
| **Validation** | Smoke quote→checkout→create ; PI total = snapshot Engine |

### Étape M3 — Cutover ops staging → prod

| | |
|---|---|
| **Objectif** | `SERVICE_*=true`, canary 5→25→50→100, Kill Switch off, Shadow on puis réduit |
| **Fichiers** | env Vercel/staging/prod uniquement (pas de delete code) |
| **Risques** | Incident prix ; fail-open silencieux |
| **Rollback** | `PRICING_ENGINE_KILL_SWITCH=true` ou `CANARY_PCT=0` / SERVICE false |
| **Validation** | Métriques `charge_path=engine` ; 0 incident ; latence OK |

### Étape M4 — Retrait fail-open + preuve Hard Gate

| | |
|---|---|
| **Objectif** | Engine obligatoire sur hot path ; fail-open retiré ; dossier P1–P5 rempli |
| **Fichiers** | `select*ChargePath*.ts` ; `PHASE-6-HARD-GATE-PROOF.md` |
| **Risques** | Erreur Engine = échec quote (plus de filet legacy) |
| **Rollback** | Réactiver fail-open via flag temporaire **si START-GATE le prévoit** |
| **Validation** | `PHASE-6-HARD-GATE-PROOF — VALIDÉ` humain |

### Étape M5 — Phase 6 Cleanup (suppressions)

| | |
|---|---|
| **Objectif** | Exécuter L1–L9 du START-GATE Phase 6 **après** `Phase 6 — APPROUVÉ` |
| **Fichiers** | voir Partie 6 |
| **Risques** | Delete prématuré |
| **Rollback** | Git revert / redeploy ; snapshots historiques intacts |
| **Validation** | `PHASE-6-COMPLETION.md` + CI + smoke Live |

---

# Partie 4 — Cartographie Feature Flags & mécanismes

## 4.1 Feature Flags env

| Nom | Rôle | Où utilisé | Pourquoi encore nécessaire | Suppression quand |
|---|---|---|---|---|
| `PRICING_ENGINE_SERVICE_FOOD` | Autorise cutover Food | `flags.ts` → `resolveChargePath` | Canary Food | Après Engine-only stable + P3 |
| `PRICING_ENGINE_SERVICE_PACKAGE` | Idem Package | idem | Idem | Idem |
| `PRICING_ENGINE_SERVICE_RIDE` | Idem Ride | idem | Idem | Idem |
| `PRICING_ENGINE_SERVICE_MARKETPLACE` | Idem Marketplace | idem | Idem | Idem |
| `PRICING_ENGINE_CANARY_PCT` | % engine | `flags.ts`, `canary.ts` | Rollout progressif | Après 100 % durable |
| `PRICING_ENGINE_SHADOW` | Active shadow ADR | `flags.ts`, `runShadowCompare.ts` | Confiance pre/post cutover | Après stabilité + décision ops |
| `PRICING_ENGINE_SHADOW_SAMPLE_PCT` | Sample shadow | `runShadowCompare.ts` | Coût/obs | Avec Shadow |
| `PRICING_ENGINE_KILL_SWITCH` | Force legacy | `killSwitch.ts` | Rollback immédiat | Dernier (ou conserver ops emergency — décision explicite) |

Constante code : `PRICING_ENGINE_MIGRATION_PHASE = 5` — passe à 6 **seulement** quand Phase 6 cleanup approuvée/exécutée selon START-GATE.

## 4.2 Mécanismes

| Mécanisme | Rôle | Où | Pourquoi nécessaire | Suppression quand |
|---|---|---|---|---|
| **Kill Switch** | Force `legacy`, coupe shadow | `killSwitch.ts` | Rollback prod | Après GO + période observation (décision ops) |
| **Shadow Compare** | Compare legacy vs engine sans changer charge | `shadow/*`, schedule sur quotes | Détecter drift | Après cutover stable |
| **Dual Path** | `select*` legacy vs engine | `charge/select*.ts` | Cutover | Après Engine-only + fail-open retiré |
| **Fail Open** | Engine fail → legacy total | `select*.ts` | Sécurité | Après preuve 0 fail-open |
| **Legacy Wrappers (adapters)** | Parité | `engine/adapters/*` | Pont migration | Après SoT Engine indépendant (réécrire ou supprimer) |
| **deliveryPricingEngine V2** | Shadow delivery non charge | `deliveryPricingEngine/*` | Observabilité parallèle | Phase 6 L6 si doublon |

---

# Partie 5 — Pourquoi `charge_path = legacy` en production

### Chaîne de décision (simplifiée)

```text
env (souvent unset)
  → resolvePricingEngineFlags()
       serviceEnabled.* = false
       canaryPct = 0
       killSwitch = false
       shadowEnabled = false
  → resolveChargePath(service)
       → resolveChargePathForPhase(...)
            → "legacy"   // SERVICE off ou canary 0
  → select*ChargePath
       → customerTotalCents = pricing legacy
       → reason: "legacy_selected"
```

### Pourquoi pas de bascule automatique vers Engine

1. **Defaults sécuritaires ADR** : Engine jamais charge par défaut.  
2. **Aucun `PRICING_ENGINE_*` posé** dans env cert / `.env.example` (audit 2026-08-03).  
3. **Canary 0** ignore même un SERVICE true partiel selon implémentation (SERVICE false → legacy).  
4. **Kill Switch** (si true) force legacy.  
5. Même si path « engine », adapters **recalculent/recopient** depuis legacy → delete legacy impossible.

### Sélecteurs encore actifs

- `resolvePricingEngineFlags`  
- `resolveChargePath` / `resolveChargePathForPhase`  
- `isInCanaryBucket`  
- `selectFoodChargePath` / `selectPackageChargePath` / `selectRideChargePath` / `selectMarketplaceChargePath`  
- `schedulePricingShadowCompare`  

### Modifications nécessaires pour bascule définitive (futur, après START-GATES)

1. M1–M2 : Engine SoT + surfaces couvertes.  
2. Env staging puis prod : `SERVICE_*=true`, `CANARY_PCT` progressif → `100`, `KILL_SWITCH=false`, Shadow selon plan.  
3. M4 : retirer fail-open ; prouver P1–P5.  
4. M5 : supprimer dual-path / flags / wrappers morts.  
5. **Ne jamais** « basculer automatiquement » sans cutover ops contrôlé.

---

# Partie 6 — Plan de suppression du legacy (plan seul)

> Exécution **uniquement** après `PHASE-6-HARD-GATE-PROOF — VALIDÉ` + `Phase 6 — APPROUVÉ`.

### Ordre recommandé de suppression

| Ordre | Quoi | Fichiers / artefacts | Notes |
|---|---|---|---|
| S1 | Branches fail-open + `chargePath==="legacy"` dans select* | `charge/select*.ts` | Après Engine obligatoire |
| S2 | Appels directs modules SoT legacy depuis routes | routes §2.5, services create | Remplacés par Engine/snapshot |
| S3 | Modules SoT legacy devenus morts | `foodOrderServerPricing.ts`, parties charge de `deliveryPricing.ts`, `deliveryRequestServerPricing.ts`, `taxiFinalPrice.ts` (chemins charge), `computeMarketplaceCheckoutShadow` charge | **Garder** helpers non-charge si encore utilisés |
| S4 | Adapters wrappers obsolètes | `engine/adapters/*` si fusionnés dans Engine core | Réécrire d’abord |
| S5 | Shadow ADR runner sur quotes | `shadow/runShadowCompare` wiring routes | Tables logs : **rétention**, pas drop aveugle |
| S6 | `deliveryPricingEngine` shadow V2 | `deliveryPricingEngine/*` | Si doublon confirmé |
| S7 | Flags migration env | docs + code `flags.ts` simplification | Kill Switch : décision ops séparée |
| S8 | Tests migration Phase 2–5 redondants | `phase2*.ts`… | Garder golden Engine |
| S9 | Docs / naming `checkout_shadow` | marketplace | Clarification |
| S10 | `PRICING_ENGINE_MIGRATION_PHASE → 6` / completion | `phaseGate.ts`, `PHASE-6-COMPLETION.md` | Clôture ADR migration |

### Tables

| Table | Action Phase 6 |
|---|---|
| `pricing_quote_snapshots` | **Conserver** (audit) |
| `pricing_shadow_compare_logs` | **Conserver** / archiver — pas truncate prod |
| `delivery_pricing_shadow_logs` (si existe) | Archiver si L6 |
| Seeds rate cards / `taxi_pricing` / business defaults | **Conserver** (SoT config) |

### APIs

- **Ne pas supprimer** les routes quote/checkout — **changer leur implémentation interne** seulement.  
- Aucune API publique à retirer pour le GO charge.

### Feature Flags à retirer (après P3)

Tous les `PRICING_ENGINE_SERVICE_*`, `CANARY_PCT`, `SHADOW`, `SHADOW_SAMPLE_PCT` — et éventuellement Kill Switch (dernier).

### Migrations SQL

- Pas de DROP obligatoire pour GO charge.  
- Migrations éventuelles : désactiver jobs shadow, indexes, commentaires — **START-GATE dédié**.

---

# Partie 7 — Checklist finale pour un véritable GO

Cocher **uniquement avec preuves** (liens métriques / CI / env / SQL) :

### Charge & runtime

- [ ] Production : **100 %** `charge_path=engine` (Food, Package, Ride, Marketplace) sur fenêtre ≥ 7 jours  
- [ ] **0** montant Stripe Checkout / PI issu d’un path legacy parallèle  
- [ ] Quotes Engine-only  
- [ ] Checkouts Engine-only  
- [ ] Creates (taxi/food/DR/marketplace) Engine-only ou snapshot immuable Engine  
- [ ] Taxes / fees / promos calculés par Engine SoT (pas capture legacy)  
- [ ] Plus de fail-open legacy sur hot path  
- [ ] Kill Switch **off** hors drills documentés  

### Code migration

- [ ] Plus d’appel charge à `computeFoodOrderPricing` / `computeDeliveryRequestPricing` / `computeDeliveryPricing` / `calculateTaxiFinalPriceSnapshot` / `computeMarketplaceCheckoutShadow` sur hot path  
- [ ] Adapters ne wrappent plus les modules historiques (ou modules historiques supprimés)  
- [ ] Dual-path `select*ChargePath` retiré ou réduit à no-op Engine-only  
- [ ] `resolveChargePath` / canary migration retirés **ou** hardcodés engine (décision START-GATE)  
- [ ] Shadow Compare ADR retiré du hot path  
- [ ] `deliveryPricingEngine` shadow V2 retiré ou justifié hors charge  

### Flags

- [ ] `PRICING_ENGINE_SERVICE_*` retirés (ou sans effet documenté)  
- [ ] `PRICING_ENGINE_CANARY_PCT` retiré  
- [ ] `PRICING_ENGINE_SHADOW` / `SHADOW_SAMPLE_PCT` retirés  
- [ ] Kill Switch : retiré **ou** conservé explicitement comme emergency-only (décision écrite)  

### Qualité & argent

- [ ] Suites pricing + checkout CI vertes  
- [ ] Paiements Live Food/Package/Taxi toujours OK (non régressés)  
- [ ] Marketplace : au minimum path Engine sur totaux (Connect Live = gate MVP-2 séparé si besoin)  
- [ ] Métriques : 0 incident charge Engine ; latence dans budget ; parity résiduelle dans seuil  
- [ ] `PHASE-6-HARD-GATE-PROOF — VALIDÉ` (humain)  
- [ ] `Phase 6 — APPROUVÉ` puis `PHASE-6-COMPLETION` après cleanup  

### Hors scope explicite (ne bloque pas GO charge si documenté)

- [ ] Settlement / commissions / payouts crons : confirmés **hors** obligation Engine-only **ou** plan Settlement dédié  
- [ ] Historique snapshots / shadow logs conservés  

---

# Partie 8 — Combien de phases restent ?

## Réponse : **5 phases restantes**

| # | Phase | Contenu | Risques | Durée estimée | Critères de validation |
|---|---|---|---|---|---|
| **1** | **5B — Independence** | Engine SoT réel (plus wrappers) | Divergence ¢ | **2–4 semaines** | Parity golden 0¢ ; adapters découplés ; START-GATE 5B |
| **2** | **5C — Surface coverage** | Quote/checkout/**create**/marketplace sur même SoT ; snapshots | Orphans prix | **1–3 semaines** | Toutes routes charge prouvées Engine ; smokes |
| **3** | **5D — Production cutover** | Flags staging→prod canary→100 % ; observabilité | Incident prix Live | **2–6 semaines** | Métriques engine 100 % ; Kill Switch non requis |
| **4** | **5E — Hard Gate re-proof** | Retrait fail-open ; remplir P1–P5 ; audit | Perte filet legacy | **1–2 semaines** | `PHASE-6-HARD-GATE-PROOF — VALIDÉ` |
| **5** | **6 — Legacy cleanup** | Suppressions L1–L9 ; flags ; shadow ; docs | Delete accidentel | **1–3 semaines** | `Phase 6 — APPROUVÉ` → `PHASE-6-COMPLETION` |

**Total indicatif :** **7–18 semaines** (forte dépendance ops cutover + parité).

**Non comptées comme « phases PE » :** MVP-2 Connect, US-AT-SCALE, Settlement Engine — gates produit/ops **parallèles**, pas substituts du Hard Gate PE.

---

## Décision / suite gouvernance

| Décision | Date | Statut |
|---|---|---|
| `PHASE-6-CLOSURE-ROADMAP — APPROUVÉ` | 2026-08-03 | **Validé** — 5 phases 5B→5C→5D→5E→6 |
| Suppressions legacy / flags / Kill Switch / Shadow | — | **Interdites** jusqu’à Phase 6 approuvée post-5E |
| Suite | 2026-08-03 | [`PHASE-5B-COMPLETION.md`](./PHASE-5B-COMPLETION.md) — en attente validation |

---

## Références

- [`PHASE-6-HARD-GATE-PROOF.md`](./PHASE-6-HARD-GATE-PROOF.md) — audit NO GO  
- [`PHASE-6-START-GATE.md`](./PHASE-6-START-GATE.md)  
- [`FEATURE-FLAGS.md`](../FEATURE-FLAGS.md)  
- `apps/web/src/lib/pricingEngine/**`  
- Modules SoT : `deliveryPricing.ts`, `foodOrderServerPricing.ts`, `deliveryRequestServerPricing.ts`, `taxiFinalPrice.ts`, `marketplaceCheckout.ts`  
