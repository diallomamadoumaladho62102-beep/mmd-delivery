# Rapport d’exécution — Cutover Pricing Engine (pré-public)

**Date :** 2026-08-03  
**Projet Vercel :** `mmd-delivery` (`prj_pqVe0VOpRFa9YZDxZTa69JccOul6`)  
**Autorisation :** fondateur — cutover charge PE ; **aucune** suppression legacy / flags / Kill / Shadow  
**Branche locale de travail :** `cursor/pe-phase-5b-independence`

---

## Décision finale

| Question | Verdict |
|---|---|
| **Cutover charge (lancement public via PE)** | **GO** |
| Hard Gate / Phase 6 cleanup (delete legacy, dual-path, flags) | **NO GO** (intentionnel — filet de sécurité) |

**GO** signifie : en Preview et en Production, `charge_path` désiré = **engine** pour Food, Package, Ride et Marketplace (`CANARY=100`, services ON, Kill OFF). Le public paie via le chemin Pricing Engine, avec fail-open / Kill Switch / Shadow / code legacy **toujours présents**.

**Ce n’est pas** « PE seule SoT au sens Hard Gate » (retrait fail-open + dual-path + delete legacy) — réservé à la Phase 6 après fenêtre d’observation.

---

## 1. Variables ajoutées / modifiées

Identiques sur **Preview** et **Production** :

| Variable | Valeur | Action |
|---|---|---|
| `PRICING_ENGINE_SHADOW` | `true` | Ajoutée / posée |
| `PRICING_ENGINE_SHADOW_SAMPLE_PCT` | `100` | Ajoutée / posée |
| `PRICING_ENGINE_CANARY_PCT` | `100` | Ajoutée / posée |
| `PRICING_ENGINE_SERVICE_FOOD` | `true` | Ajoutée / posée |
| `PRICING_ENGINE_SERVICE_PACKAGE` | `true` | Ajoutée / posée |
| `PRICING_ENGINE_SERVICE_RIDE` | `true` | Ajoutée / posée |
| `PRICING_ENGINE_SERVICE_MARKETPLACE` | `true` | Ajoutée / posée |
| `PRICING_ENGINE_KILL_SWITCH` | `false` | Ajoutée / posée |

Aucune autre variable d’infra (Stripe, Supabase, etc.) n’a été modifiée pour ce cutover.

---

## 2. Environnements concernés

| Environnement | Déploiement | Alias / URL | État |
|---|---|---|---|
| **Preview** | `dpl_D8bzaZYcrWJwfNrq9B9TRE7AFtZK` | `https://mmd-delivery-kzi84bhqd-diallomamadoumaladho62102-beeps-projects.vercel.app` | READY |
| **Production** | `dpl_ExFMDtb3K7adV6E4BZ1muccCPNz7` | Aliased → `https://www.mmddelivery.com`, `https://mmddelivery.com`, `https://mmd-delivery.vercel.app` | READY |

Inspect Production : target `production`, status Ready, créé ~2026-08-03 05:35 EDT.

---

## 3. Résultats des tests (régression automatique)

| Suite | Résultat |
|---|---|
| Phase 5B independence | **OK** |
| Phase 5C surface coverage | **OK** (defaults legacy ; engine quand flagged) |
| Phase 5D cutover readiness | **OK** |
| Phase 2 parity harness | **OK** — **520/520**, **100 %** parité (food/package/ride/marketplace = 130 chacun, 0 diff) |
| Phase 3 / 4 / 5 cutover | **OK** (fail-open = 0 dans les samples) |
| Readiness env cutover (flags ON) | **blockers: []** ; paths = `engine` × 4 ; Kill OFF ; canary 100 ; shadow ON |

Recommandation readiness : observer ≥ 7 jours avant Hard Gate GO / retrait fail-open.

---

## 4. Vérifications runtime Preview / Production

| Check | Preview | Production |
|---|---|---|
| Flags PE posés | Oui | Oui |
| Redeploy READY | Oui | Oui |
| `/api/health` (Bearer CRON) | `ok:true`, platform_countries count=11 | `ok:true`, platform_countries count=11 |
| Site `www.mmddelivery.com` | — | HTTP 200 |
| `/api/health/stripe-webhook` | OK (session antérieure) | `ok:true`, canonical webhook `www.mmddelivery.com`, **9** events/24h |
| Quotes / Checkouts / Paiements Live E2E | **Non exécutés session complète** (auth utilisateur / Stripe Live requis) | Idem |
| Taxes / Promotions / Commissions / Reversements Live | Couverture **parité + code** ; **pas** de smoke transactionnel Live bout-en-bout dans cette session | Idem |

---

## 5. Comportement par verticale (charge)

Avec l’env posé, `inspectPricingEngineCutoverReadiness` :

| Service | `desiredPathWithCanaryKey` | Service flag | Comportement attendu en prod |
|---|---|---|---|
| **Ride** | `engine` | ON | Totaux charge via PE ; legacy capturé pour shadow / fail-open |
| **Food** | `engine` | ON | Idem |
| **Package** | `engine` | ON | Idem (fix discount PE déjà en place) |
| **Marketplace** | `engine` | ON | Idem |

Parité shadow harness : **100 %** sur les 4 services.

---

## 6. Anomalies

| Sévérité | Anomalie | Impact cutover |
|---|---|---|
| Info | 2 déploiements Preview **Error** avant le Preview READY (erreurs TypeScript adapters / `EnvLike`) — **corrigées**, redeploy OK | Aucun (Preview final READY) |
| Résiduel ops | Smokes Live quote→checkout→pay→commission→reversement **non** rejoués bout-en-bout dans cette session | Observation post-cutover recommandée ; rollback = Kill Switch / CANARY=0 |
| Intentionnel | Dual-path, fail-open, Kill Switch, Shadow, code legacy **conservés** | Filet Phase 6 — **pas** une anomalie |

Aucune anomalie bloquante détectée sur health prod, readiness flags, ou suites PE.

---

## 7. Sécurité / non-faits (conformité mandat)

| Interdit | Statut |
|---|---|
| Supprimer moteur legacy | **Non fait** |
| Supprimer Feature Flags | **Non fait** |
| Supprimer Kill Switch | **Non fait** |
| Supprimer Shadow Compare | **Non fait** |
| Supprimer code legacy / dual-path | **Non fait** |

Rollback immédiat documenté (runbook 5D) :

- `PRICING_ENGINE_KILL_SWITCH=true`, ou  
- `PRICING_ENGINE_CANARY_PCT=0`, ou  
- `PRICING_ENGINE_SERVICE_<X>=false`

---

## 8. Prochaines étapes (hors cutover charge)

1. Observer métriques `charge_path=engine` / fail-open ≈ 0 (idéalement fenêtre runbook D7).  
2. Smokes Live contrôlés Food / Package / Ride / Marketplace (paiements, taxes, promos, commissions, reversements).  
3. Rejouer Hard Gate (`PHASE-6-HARD-GATE-PROOF`) **après** preuves.  
4. Phase 6 Legacy Cleanup **uniquement** après Hard Gate GO + approbation START-GATE.

---

## 9. Synthèse GO / NO GO

```
GO  → Cutover charge Pricing Engine en production (CANARY 100 %, 4 services ON).
NO GO → Hard Gate / suppression legacy (Phase 6) — filets volontairement conservés.
```
