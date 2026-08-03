# Décision — Cutover Pricing Engine avant lancement public

**Date :** 2026-08-03  
**Décision fondateur :** le lancement public doit utiliser le Pricing Engine comme **unique source de vérité** (pas de public sur legacy puis migration).  
**Exécution agent :** tout le faisable sans risque + sans accès prod MMD.  
**Verdict d’arrêt :** **MIGRATION NON TERMINÉE** — arrêt volontaire (sécurité + accès).  

---

## 1. Verdict

| Question | Réponse |
|---|---|
| Le cutover complet « PE seule SoT » est-il **terminé** ? | **NON** |
| Peut-on le forcer maintenant sans risque ? | **NON** — voir §3 |
| Le code est-il **prêt** pour un cutover pré-public via env ? | **OUI** (5B + 5C + tests) |
| Que manque-t-il ? | Actions **humaines** sur le vrai env staging/prod (§5) |
| Hard Gate / Phase 6 cleanup (delete legacy) ? | **Toujours NO GO** jusqu’à preuves post-cutover |

---

## 2. Ce qui est déjà en place (preuves automatiques 2026-08-03)

| Domaine | État | Preuve |
|---|---|---|
| PE compute indépendant (Ride/Food/Package/Marketplace) | **OK** | `phase5b.independence` |
| Surfaces quote/checkout/**create** sous `select*` | **OK** | `phase5c.surfaceCoverage` |
| Parité shadow 520 compares | **100 %** | `phase2ParityHarness` |
| Cutover simulé flags ON → `charge_path=engine` | **OK** | `phase3/4/5` + `phase5d` |
| Kill Switch / fail-open / Shadow | **Présents** (filet) | intentionnel |
| Readiness env local / cert | Charge = **legacy** (canary 0, SERVICE off) | `pricing-engine-5d-readiness.mjs` |
| Vercel projet CLI lié | **0 variables** — sandbox, pas prod MMD | `vercel env ls` |

**Aucune** suppression legacy / dual-path / flags / Kill / Shadow n’a été faite.

---

## 3. Pourquoi arrêt immédiat (pas de forçage)

Conformément à « aucune prise de risque » :

### Blocage A — Risque de régression Live

Food / Package / Taxi sont déjà en **paiements Live** (pilot).  
Inverser les **defaults code** vers engine à 100 % sans pose contrôlée sur le **vrai** projet Vercel + observation = risque prix/paiement sur le trafic existant.

→ **Refusé** de changer les defaults `resolvePricingEngineFlags` dans le code.

### Blocage B — PE n’est pas encore « seule » SoT au sens Hard Gate

Même avec `charge_path=engine` :

1. Les routes appellent encore `compute*` / `calculateTaxi*` **avant** `select*` (capture IO).  
2. Le **fail-open** peut renvoyer le total legacy.  
3. Dual-path + Kill Switch + Shadow restent nécessaires jusqu’à preuves stables.

→ Retirer dual-path / désactiver legacy **maintenant** = **risque** → **refusé**.

### Blocage C — Accès production / staging MMD absent

- Pas de `PRICING_ENGINE_*` dans les env locaux/cert.  
- Projet Vercel auto-lié = vide / non-MMD → **aucune** mutation distante effectuée.  
- Pas de métriques prod `charge_path=engine`, pas de canary live, pas de fenêtre d’observation.

→ D1–D7 du runbook = **actions humaines uniquement**.

---

## 4. Ce que « PE unique SoT avant public » signifie opérationnellement

### Étape 1 — Cutover charge (obligatoire avant public)

Sur **staging puis prod** (vrai projet Vercel MMD) :

```bash
PRICING_ENGINE_SHADOW=true
PRICING_ENGINE_SERVICE_FOOD=true
PRICING_ENGINE_SERVICE_PACKAGE=true
PRICING_ENGINE_SERVICE_RIDE=true
PRICING_ENGINE_SERVICE_MARKETPLACE=true
PRICING_ENGINE_CANARY_PCT=100
PRICING_ENGINE_KILL_SWITCH=false
```

Redeploy → vérifier readiness → smokes quote/checkout/create/pay → observer (staging d’abord).

À ce stade : **le public paiera via le chemin Engine** (label + total `select*`), avec filet fail-open/Kill encore en place.

### Étape 2 — Preuves (obligatoire avant de retirer le filet)

- 0 fail-open significatif  
- 0 incident prix / PI  
- Parité / snapshots OK  
- (Idéalement) fenêtre stable ; pré-public peut être plus courte que 7 j **si** staging + smokes Live pilot OK — décision ops explicite

### Étape 3 — Hard Gate puis Phase 6 (après preuves)

Seulement alors : retrait fail-open → dual-path → flags → code legacy (START-GATE Phase 6 + approbation).

**Le lancement public peut intervenir après l’Étape 1+2 réussies**, sans attendre le delete Phase 6 — à condition que `CANARY=100` + SERVICE=* soient **effectivement** posés en prod.

---

## 5. Liste exacte des actions humaines restantes

### A. Staging (vrai projet)

| # | Action |
|---|---|
| A1 | Identifier le projet Vercel **staging** MMD Delivery (pas le sandbox CLI local) |
| A2 | Poser les 7 variables §4 Étape 1 (`CANARY` peut commencer à 5 puis monter à 100) |
| A3 | Redeploy staging |
| A4 | Exécuter : `pnpm exec tsx scripts/pricing-engine-5d-readiness.mjs` (avec env staging) → blockers = 0, path = engine |
| A5 | Smokes : quote → checkout → paiement test Food / Package / Taxi / Marketplace |
| A6 | Vérifier fail-open ≈ 0, totaux, taxes/fees, pas d’écart PI |
| A7 | Drill Kill Switch puis retour |

### B. Production (avant ouverture public)

| # | Action |
|---|---|
| B1 | Poser les **mêmes** flags sur Vercel **Production** (`CANARY_PCT=100`) |
| B2 | Redeploy production |
| B3 | Smokes Live (montants réels contrôlés) sur les 4 verticales |
| B4 | Confirmer commissions / reversements inchangés (settlement hors PE charge — smoke BAU) |
| B5 | Documenter : « Pre-public PE cutover — charge engine 100 % » + date |
| B6 | **Alors seulement** : ouverture publique |

### C. Après lancement (ou juste avant si staging impeccable)

| # | Action |
|---|---|
| C1 | Collecter preuves pour rejouer Hard Gate |
| C2 | `PHASE-6-HARD-GATE-PROOF — VALIDÉ` humain |
| C3 | `Phase 6 — APPROUVÉ` puis cleanup legacy |

**Durée estimée A+B :** **2–5 jours** (staging serré + smokes) si pas de fenêtre 7 j exigée pré-public.  
**Durée si vous exigez 7 j prod avant public :** **+7 jours**.

---

## 6. Hard Gate rejouable après ces actions ?

| Après | Hard Gate GO possible ? |
|---|---|
| A+B seuls (charge engine 100 %, dual-path encore là) | **Pas encore GO cleanup** — mais **objectif lancement public PE** atteint pour la charge |
| A+B + preuves stabilité + retrait fail-open décidé | **Oui** — rejouer Hard Gate puis Phase 6 |

---

## 7. Engagement agent (cette session)

| Fait | Non fait (refusé / impossible) |
|---|---|
| Tests / harness / readiness | Mutation Vercel prod/staging MMD |
| Doc pre-public + liste actions | Defaults code → engine 100 % |
| Fix parité package (session précédente) | Delete legacy / dual-path / flags / Kill / Shadow |

---

## 8. Recommandation officielle

1. **Ne pas** lancer le public tant que B1–B3 ne sont pas faits.  
2. **Exécuter** A puis B (flags env) — c’est le cutover charge pré-public.  
3. **Conserver** dual-path / Kill / Shadow jusqu’à preuves post-cutover.  
4. Revenir pour Hard Gate + Phase 6 **après** preuves, pas avant.

*Rapport d’arrêt sécurisé — cutover pré-public — 2026-08-03.*
