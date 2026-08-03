# Rapport de fin — Phase 5 (Marketplace Cutover)

**Date:** 2026-08-01  
**Statut:** **CLÔTURÉE** (validation humaine 2026-08-01)  
**ADR:** ADR-001 FINAL  
**Gate:** [PHASE-5-START-GATE](./PHASE-5-START-GATE.md) — **APPROUVÉ**  
**Phase code:** `PRICING_ENGINE_MIGRATION_PHASE = 5`

---

## 1. Objectif

Migrer progressivement **MMD Marketplace** vers le Pricing Engine, sous Feature Flags + Canary, avec rollback Kill Switch, **sans modifier** Food / Package / Ride hors régression de tests.

---

## 2. Étapes réellement exécutées

| Étape | Contenu | Statut |
|---|---|---|
| **5.0** | `PRICING_ENGINE_MIGRATION_PHASE = 5` ; `resolveChargePath` autorise `marketplace` | **Fait** |
| **5.1** | `selectMarketplaceChargePath` + fail-open + Quote Snapshot + métriques | **Fait** |
| **5.2–5.3** | Ladder canary simulée 1→5→25→50→100 % | **Fait** (tests) |
| **5.4** | Hooks draft/checkout `marketplaceOrderService` + live checkout | **Fait** (code) |
| **Ops canary prod** | Activation progressive `SERVICE_MARKETPLACE` + `CANARY_PCT` | **À faire ops** — défauts = **0 % Engine Marketplace** |
| **5.5** | Migration DB + ce rapport | **Fait** |

**Aucun passage direct à 100 % en production** : flags OFF / canary 0 par défaut.

---

## 3. Résultats du Canary (simulation)

Suite `phase5.cutover.test.ts` — 1000 clés stables :

| Canary % | Ratio Engine observé | Tolérance |
|---|---|---|
| 1 % | ≈ 1 % (±3 pp) | OK |
| 5 % | ≈ 5 % | OK |
| 25 % | ≈ 25 % | OK |
| 50 % | ≈ 50 % | OK |
| 100 % | 100 % exact | OK |

- Même `canaryKey` (user id) → même chemin draft/checkout.
- Phase 4 regression : marketplace reste legacy à `phase=4`.

### Activation ops recommandée

1. Staging Marketplace @ 5 % → valider  
2. Staging ↑ 25 → 50 → 100 %  
3. Prod Marketplace @ 1–5 % puis paliers  

---

## 4. Métriques

| Métrique | Résultat |
|---|---|
| Cutover Marketplace (`marketplaceLegacy` / `Engine` / `FailOpen`) | OK en tests |
| Shadow harness 520 | **100 %** equal |
| Fail-open Marketplace | 0 sur jeux de tests |
| Defaults (flags OFF) | **100 % legacy** tous services |

---

## 5. Écarts éventuels

Aucun écart monétaire (0¢) sur les sélections Engine testées (adapter Marketplace parity).

---

## 6. Incidents rencontrés

**Aucun** pendant l’implémentation / suites automatisées.

Procédure ops : Kill Switch ou `SERVICE_MARKETPLACE=false` → documenter avant nouvelle tentative.

---

## 7. Actions correctives

N/A. Ajustements de tests Phases 2–4 pour refléter le scope Phase 5.

---

## 8. Résultats des tests

| Suite | Résultat |
|---|---|
| `flags.phase0.test.ts` | OK |
| `phase1.parity.test.ts` | OK |
| `phase2.shadow` / kill / harness 520 | OK |
| `phase3.cutover.test.ts` | OK |
| `phase4.cutover.test.ts` | OK |
| `phase5.cutover.test.ts` | OK |

---

## 9. Confirmation Marketplace / Pricing Engine

| Surface | Comportement |
|---|---|
| Draft marketplace | `selectMarketplaceChargePath` → `charge_path` + snapshot dans `checkout_shadow` |
| Checkout pending | Idem ; `total_cents` = sélection |
| Live Stripe checkout | Montant = sélection Engine/Legacy |
| Food / Package / Ride | Non modifiés (hors phase gate / tests) |
| Quote Snapshot | `pricing_quote_snapshots` accepte `marketplace` |
| Rollback | Kill Switch / service OFF / canary 0 — **opérationnel** |

**Par défaut :** Marketplace reste sur le **chemin historique**.  
**Avec flags + canary :** Marketplace peut utiliser correctement le **Pricing Engine** (parity wrappers + snapshot).

---

## 10. Livrables

| Élément | Emplacement |
|---|---|
| Phase gate = 5 | `phaseGate.ts` |
| `resolveChargePath` Marketplace | `killSwitch.ts` |
| Sélection Marketplace | `charge/selectMarketplaceChargePath.ts` |
| Snapshots | + migration `20261101160000_pricing_quote_snapshots_marketplace.sql` |
| Wiring | `marketplaceOrderService.ts`, `marketplaceLiveCheckoutService.ts` |

**Non modifié :** architecture ADR, contrats, pipeline, autres verticales métier.

---

## 11. Recommandations concernant la Phase 6 (Cleanup)

1. ~~Ne pas démarrer Phase 6 tant que ce rapport n’est pas validé.~~ **Phase 5 CLÔTURÉE.**  
2. Examiner [PHASE-6-START-GATE](./PHASE-6-START-GATE.md) — **`Phase 6 — REPORTÉ`** ; voir [PHASE-6-HARD-GATE-PROOF](./PHASE-6-HARD-GATE-PROOF.md).  
3. Ops : activer / stabiliser les paliers canary jusqu’à Engine en prod (preuve P1–P5).  
4. **Aucun** cleanup (code, flags, services, tables) tant que la preuve n’est pas validée et Phase 6 ré-approuvée.  
5. Phase 6 = cleanup uniquement — pas de nouvelle fonctionnalité.

---

## 12. Décision

- **`Phase 5 — CLÔTURÉE`** — validée le 2026-08-01  
- Prochaine étape documentaire : [PHASE-6-START-GATE](./PHASE-6-START-GATE.md)  
- Architecture ADR-001 et feuille de route **inchangées**.
