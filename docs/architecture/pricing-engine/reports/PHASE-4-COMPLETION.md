# Rapport de fin — Phase 4 (Ride Cutover)

**Date:** 2026-08-01  
**Statut:** **CLÔTURÉE** (validation humaine 2026-08-01)  
**ADR:** ADR-001 FINAL  
**Gate:** [PHASE-4-START-GATE](./PHASE-4-START-GATE.md) — **APPROUVÉ**  
**Phase code:** `PRICING_ENGINE_MIGRATION_PHASE = 4`

---

## 1. Objectif

Migrer progressivement **MMD Ride (Taxi)** vers le Pricing Engine, sous Feature Flags + Canary, avec rollback Kill Switch, **sans toucher Marketplace**.

---

## 2. Étapes réellement exécutées

| Étape | Contenu | Statut |
|---|---|---|
| **4.0** | `PRICING_ENGINE_MIGRATION_PHASE = 4` ; `resolveChargePath` autorise `ride` ; Marketplace hard-scoped legacy | **Fait** |
| **4.1** | `selectRideChargePath` + fail-open + Quote Snapshot Ride + métriques | **Fait** |
| **4.2–4.3** | Ladder canary simulée 1→5→25→50→100 % | **Fait** (tests) |
| **4.4** | Hooks `/api/taxi/rides/quote` + `create-taxi-quote-checkout-session` | **Fait** (code) |
| **Ops canary prod** | Activation progressive `SERVICE_RIDE` + `CANARY_PCT` | **À faire ops** — défauts = **0 % Engine Ride** |
| **4.5** | Migration DB ride sur snapshots + ce rapport | **Fait** |

**Aucun passage direct à 100 % en production** : `SERVICE_RIDE` OFF et `CANARY_PCT=0` par défaut.

---

## 3. Résultats du Canary (simulation)

Suite `phase4.cutover.test.ts` — 1000 clés stables :

| Canary % | Ratio Engine observé | Tolérance |
|---|---|---|
| 1 % | ≈ 1 % (±3 pp) | OK |
| 5 % | ≈ 5 % | OK |
| 25 % | ≈ 25 % | OK |
| 50 % | ≈ 50 % | OK |
| 100 % | 100 % exact | OK |

- Même `canaryKey` (user id) → même chemin quote/checkout.
- Marketplace reste **legacy** même avec `SERVICE_MARKETPLACE=true`.

### Activation ops recommandée

1. Staging Ride @ 5 % → valider  
2. Staging ↑ 25 → 50 → 100 %  
3. Prod Ride @ 1–5 % puis paliers  

---

## 4. Métriques

| Métrique | Résultat |
|---|---|
| Cutover Ride (`rideLegacy` / `rideEngine` / `rideFailOpen`) | Compteurs OK en tests |
| Shadow harness 520 | **100 %** equal |
| Fail-open Ride | 0 sur jeux de tests |
| Marketplace charge | **100 % legacy** |

---

## 5. Écarts éventuels

Aucun écart monétaire (0¢) sur les sélections Engine testées (adapter Ride parity).

---

## 6. Incidents rencontrés

**Aucun** pendant l’implémentation / suites automatisées.

Procédure ops : Kill Switch → legacy → documenter avant nouvelle tentative.

---

## 7. Actions correctives

N/A. Ajustements de tests Phase 2/3 pour refléter le scope Phase 4 (Ride engine-capable ; Marketplace toujours legacy).

---

## 8. Résultats des tests

| Suite | Résultat |
|---|---|
| `flags.phase0.test.ts` | OK |
| `phase1.parity.test.ts` | OK |
| `phase2.shadow.test.ts` / kill / harness 520 | OK |
| `phase3.cutover.test.ts` | OK |
| `phase4.cutover.test.ts` | OK |

---

## 9. Confirmation Ride / Pricing Engine

| Surface | Comportement |
|---|---|
| Taxi quote | `selectRideChargePath` → `charge_path` + `engine_quote_snapshot_id` |
| Taxi quote checkout | Montant Stripe = sélection ; intent enrichi |
| Tips taxi | **Non modifié** (hors Engine) |
| Marketplace | **Non modifié** — legacy |
| Food / Package | Inchangés (Phase 3) |
| Quote Snapshot | `pricing_quote_snapshots` accepte `ride` |
| Rollback | Kill Switch / `SERVICE_RIDE=false` / canary 0 — **opérationnel** |

**Par défaut :** Ride reste sur le **moteur historique**.  
**Avec flags + canary :** Ride peut utiliser correctement le **Pricing Engine** (parity wrappers + snapshot).

---

## 10. Livrables

| Élément | Emplacement |
|---|---|
| Phase gate = 4 | `phaseGate.ts` |
| `resolveChargePath` Ride | `killSwitch.ts` |
| Sélection Ride | `charge/selectRideChargePath.ts` |
| Snapshots | étendus + migration `20261101150000_pricing_quote_snapshots_ride.sql` |
| Routes | `taxi/rides/quote`, `create-taxi-quote-checkout-session` |

**Non modifié :** architecture ADR, contrats, pipeline, Marketplace, tips.

---

## 11. Recommandations concernant la Phase 5 (Marketplace)

1. ~~Ne pas démarrer Phase 5 tant que ce rapport n’est pas validé.~~ **Phase 4 CLÔTURÉE.**  
2. Examiner [PHASE-5-START-GATE](./PHASE-5-START-GATE.md) — **aucun développement avant `Phase 5 — APPROUVÉ`**.  
3. Ops : poursuivre les paliers canary Ride staging/prod si non terminés.  
4. Conserver Kill Switch et Shadow.  
5. Ne pas activer `SERVICE_MARKETPLACE` tant que le gate Phase 5 n’est pas approuvé.

---

## 12. Décision

- **`Phase 4 — CLÔTURÉE`** — validée le 2026-08-01  
- Prochaine étape documentaire : [PHASE-5-START-GATE](./PHASE-5-START-GATE.md)  
- Architecture et feuille de route **inchangées** ; aucune nouvelle fonctionnalité hors roadmap.
