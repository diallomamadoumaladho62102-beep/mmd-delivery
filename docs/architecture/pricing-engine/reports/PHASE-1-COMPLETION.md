# Rapport de fin — Phase 1 (Configuration)

**Date:** 2026-08-01  
**Statut:** Implémentation terminée — en attente de validation humaine de clôture  
**ADR:** ADR-001 FINAL  
**Charge path:** **legacy uniquement** (`PRICING_ENGINE_MIGRATION_PHASE = 1`, `resolveChargePath` → `legacy`)

---

## 1. Objectif atteint

Externalisation des constantes métier vers une source de configuration unique (`PRICING_BUSINESS_DEFAULTS` + table `pricing_business_defaults`), **sans modification des formules**. Parité vérifiée par tests.

---

## 2. Constantes déplacées vers la configuration

| Clé | Valeur | Consommateurs |
|---|---|---|
| `delivery_base_fare` | 2.5 | `deliveryPricing` |
| `delivery_per_mile` | 0.9 | idem |
| `delivery_per_minute` | 0.15 | idem |
| `delivery_min_fare` | 3.49 | idem |
| `delivery_driver_share_pct` | 80 | idem |
| `delivery_platform_share_pct` | 20 | idem |
| `delivery_fee_abnormal_*` | 8 / 40 | idem |
| `delivery_v2_*` | 2.5/0.9/0.15/0.99/1/3.49 | V2 customer shadow |
| `delivery_v2_driver_*` / pickup | 0.72/0.12/0.05/0.75 | V2 driver shadow |
| `marketplace_delivery_fee_floor_cents` | 299 | `marketplaceCheckout` |
| `marketplace_delivery_fee_pct` | 0.08 | idem |
| `food_legacy_tax_rate` | 0.0888 | Food tax fallback |
| `taxi_shared_ride_discount_percent` | 15 | taxi shared |
| `taxi_shared_ride_match_window_minutes` | 15 | taxi shared |
| `taxi_quote_drift_tolerance_*` | 50 / 0.02 | `taxiFinalPrice` |
| `taxi_no_show_compensation_pct` | 0.05 | `waitTimerService` |
| `taxi_tip_min_cents` | 50 | tip PaymentIntent route |
| `wait_*` / arrival meters | 5, 25, 3, 30, 5, 225, 50, 150 | `waitTimerTypes` |
| `mmd_credit_min_residual_cents` | 50 | loyalty credit |
| `driver_cashout_minimum_cents` | 2000 | driver wallet |
| `driver_cashout_cooldown_ms` | 86400000 | driver wallet |

**Source code:** `apps/web/src/lib/pricingEngine/config/businessDefaults.ts`  
**DB mirror:** `supabase/migrations/20261101120000_pricing_business_defaults.sql`

---

## 3. Constantes restantes (justification)

| Élément | Pourquoi restant |
|---|---|
| Seeds `taxi_pricing` / `pricing_config` Admin | Déjà configurables en DB ; hors hardcode TS |
| Fallback commission SQL 15%/5% Phase-4 | Déjà dans tables commission ; SQL filet si vide — Phase 2+/Admin |
| FX static `taxiFx.ts` | Affichage / fallback change — backlog BL si besoin |
| UI `DriverPayout` −5% / earnings page fantôme | Faux calcul UI — **Phase 6 cleanup** (pas de change UX en Phase 1) |
| Multipliers V2 score 0.9–1.1, demand×0.15 | Heuristiques shadow — reportées (non charge live) ; partiellement externalisées (base rates done) |
| Mirrors mobile `0.0888` / delivery defaults | Preview client seulement ; SoT serveur — backlog / Phase 2 sync |
| Tip presets UI (2,3,5$) | UX only, pas formule |
| Loyalty conversion 100 pts→500¢ defaults | Déjà dans settings/DB path |

---

## 4. Tables créées / mises à jour

| Table | Action |
|---|---|
| `public.pricing_business_defaults` | **Créée** + seeds parity + RLS admin/founder |

Aucune modification des tables `orders`, `taxi_rides`, commissions, paiements.

---

## 5. Feature Flags

| Flag | Phase 1 |
|---|---|
| `PRICING_ENGINE_SHADOW` | inchangé (non branché charge) |
| `PRICING_ENGINE_*_SERVICE_*` | OFF |
| `PRICING_ENGINE_CANARY_PCT` | 0 |
| `PRICING_ENGINE_KILL_SWITCH` | opérationnel |
| `PRICING_ENGINE_MIGRATION_PHASE` | **1** (code constant) |

**Nouveau Pricing Engine non activé.** Chemin production = historique.

---

## 6. Résultats des tests de parité

| Suite | Résultat |
|---|---|
| `pricingEngine/phase1.parity.test.ts` | **OK** (golden V1/V2/wait/taxi/mkt) |
| `pricingEngine/flags.phase0.test.ts` | **OK** (phase=1, charge=legacy) |
| `test:delivery-pricing` | **OK** |
| `test:delivery-pricing-v2` | **OK** |
| `test:wait-fee` | **OK** |
| `test:marketplace-checkout` | **OK** |
| `test:loyalty` | **OK** |

**Différences détectées :** aucune (0¢ sur jeux golden).

---

## 7. Risques identifiés

| Risque | Niveau | Mitigation |
|---|---|---|
| Édition Admin DB diverge du runtime in-code | Moyen | Runtime Phase 1 = **in-code defaults** ; DB = miroir/audit ; pas encore “DB wins” |
| Migration non appliquée en prod | Faible | Code n’exige pas la table pour fonctionner |
| Oubli mobile mirrors | Faible | Preview only ; documenté restant |

---

## 8. Recommandations avant Phase 2

1. Appliquer la migration `20261101120000_pricing_business_defaults.sql` sur les environnements.
2. Valider manuellement un quote Food + Taxi + Package en staging (sanity).
3. Ne pas activer `PRICING_ENGINE_SHADOW` en prod tant que le harness Phase 2 n’est pas prêt.
4. Phase 2 : implémenter le Pricing Engine en parallèle + Shadow Compare ; **charge reste legacy**.
5. Backlog : sync mobile previews ; retirer UI faux −5% en Phase 6.

---

## 9. Critères de réussite (auto-évaluation)

| Critère | Statut |
|---|---|
| Comportement identique (tests) | OK |
| Valeurs métier externalisées (périmètre Phase 1) | OK |
| Tests de parité concluants | OK |
| Impact utilisateur | Aucun attendu |
| Engine non activé | OK |

**Demande :** répondre `Phase 1 — CLÔTURÉE` ou lister des écarts à corriger.  
**Phase 2** ne démarrera qu’après validation + rapport de gate Phase 2.
