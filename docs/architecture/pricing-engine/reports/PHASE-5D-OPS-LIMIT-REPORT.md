# Phase 5D — Rapport limite d’accès (cutover ops)

**Date :** 2026-08-03  
**Objectif :** Exécuter tout le faisable automatiquement ; s’arrêter à la limite des accès réels.  
**Verdict Hard Gate :** toujours **`NO GO`** — cutover staging/prod **non exécuté**.  
**Réf. :** [`PHASE-5D-CUTOVER-RUNBOOK.md`](./PHASE-5D-CUTOVER-RUNBOOK.md) · [`PHASE-6-HARD-GATE-PROOF.md`](./PHASE-6-HARD-GATE-PROOF.md)

---

## 1. Ce qui a été exécuté automatiquement (preuves)

| Action | Résultat | Preuve |
|---|---|---|
| Probe présence flags PE dans fichiers locaux / cert | **0 clé `PRICING_ENGINE_*`** dans `.env.example` (avant patch), `.env.local`, `apps/web/.env.local`, `final-certification.env` | `node scripts/pricing-engine-5d-ops-probe.mjs` |
| Readiness sur env local chargé | Phase 5 · canary **0** · tous SERVICE **off** · path **legacy** · 5 blockers | `pnpm exec tsx scripts/pricing-engine-5d-readiness.mjs` |
| Ajout documentation flags dans `.env.example` | **Fait** — defaults **legacy-safe** (false / canary 0) | `.env.example` |
| Fix parité Package (discounts) + harness aligné PE V1 | **Fait** | `packageAdapter.ts`, `phase2ParityHarness.ts` |
| Harness shadow 520 compares | **100 % parity** · charge toujours legacy · 0 Stripe | `phase2ParityHarness.ts` |
| Tests 5B / 5C / 5D readiness | **OK** | sorties console |
| Tests phase0 flags, phase1 parity, phase2 shadow+kill, phase3–5 cutover | **OK** | sorties console |
| Compte GitHub CLI | Connecté (`gh auth status`) | auth OK — **pas** utilisé pour muter env hébergeur |
| Compte Vercel CLI | `vercel whoami` → compte personnel | voir §2 |

### Readiness locale (valeurs dérivées, pas de secrets)

```json
{
  "migrationPhase": 5,
  "canaryPct": 0,
  "shadowEnabled": false,
  "serviceEnabled": { "food": false, "package": false, "ride": false, "marketplace": false },
  "servicesDesiredPath": {
    "food": "legacy",
    "package": "legacy",
    "ride": "legacy",
    "marketplace": "legacy"
  },
  "readyForCanaryIncrease": false
}
```

---

## 2. Limite atteinte — ce qui n’a **pas** été fait (et pourquoi)

| Étape runbook | Statut | Raison |
|---|---|---|
| D1–D4 Staging canary 5→100 | **NON FAIT** | Aucun accès confirmé à l’env **staging** MMD ; projet Vercel auto-lié = `…/web` avec **« No Environment Variables found »** — **pas** le projet prod MMD (refusé de muter) |
| D5–D7 Prod canary→100 + 7 j | **NON FAIT** | Pas d’accès env production MMD ; observation multi-jours impossible depuis cet agent |
| Pose `PRICING_ENGINE_*` sur Vercel Production/Preview | **NON FAIT** | Projet lié vide / non-prod ; risque de configurer le mauvais projet |
| Métriques prod `charge_path=engine` | **NON FAIT** | Pas de logs/snapshots prod accessibles ici |
| Kill Switch drill staging live | **NON FAIT** | Nécessite déploiement staging réel |
| Smokes Live Food/Package/Taxi/Marketplace sous canary | **NON FAIT** | Nécessite staging/prod + Stripe Live |

**Décision agent :** aucune mutation d’environnement distant n’a été appliquée.

---

## 3. Actions humaines indispensables (liste exacte)

À exécuter **par vous / l’équipe d’exploitation** sur le **bon** projet Vercel (staging puis prod), pas sur le sandbox CLI local.

### A. Staging (ordre strict)

1. Ouvrir le projet Vercel **staging MMD Delivery** (pas le lien local vide).  
2. Ajouter / mettre à jour :
   - `PRICING_ENGINE_SHADOW=true`
   - `PRICING_ENGINE_SERVICE_FOOD=true`
   - `PRICING_ENGINE_SERVICE_PACKAGE=true`
   - `PRICING_ENGINE_SERVICE_RIDE=true`
   - `PRICING_ENGINE_SERVICE_MARKETPLACE=true`
   - `PRICING_ENGINE_CANARY_PCT=5`
   - `PRICING_ENGINE_KILL_SWITCH=false`
3. Redeploy staging.  
4. Vérifier readiness (log ou script) : blockers ↓ ; ~5 % path engine.  
5. Observer **24–48 h** : fail-open ≈ 0 ; 0 incident prix.  
6. Monter canary **25 → 50 → 100** (paliers D2–D4) avec observation à chaque palier.  
7. Smokes quote→checkout→create Food / Package / Taxi / Marketplace à canary 100.  
8. Drill Kill Switch (`KILL_SWITCH=true` puis off) documenté.

### B. Production (après staging vert)

9. Répéter avec `CANARY_PCT=5` en prod (D5).  
10. Paliers **25 → 50 → 100** (D6).  
11. Maintenir **CANARY=100 ≥ 7 jours** (D7) avec :
    - 0 incident Live  
    - fail-open ≈ 0  
    - preuves `pricing_quote_snapshots` / métriques cutover  

### C. Re-proof Hard Gate

12. Fournir les preuves prod (env + métriques + période).  
13. Relancer / faire valider `PHASE-6-HARD-GATE-PROOF — VALIDÉ`.  
14. Seulement alors : `Phase 6 — APPROUVÉ` (cleanup).

---

## 4. Temps estimé (ops humain)

| Bloc | Durée estimée |
|---|---|
| Config staging + redeploy + D1 (5 %) | **0,5–1 jour** calendaire |
| Ladder staging 25→100 + smokes (D2–D4) | **3–5 jours** |
| Prod 5 % + observation (D5) | **2–3 jours** |
| Prod 25→100 (D6) | **3–7 jours** |
| Fenêtre 100 % ≥ 7 j (D7) | **7 jours** (incompressible) |
| **Total indicatif jusqu’à rejouable Hard Gate** | **≈ 16–23 jours** calendaires |

---

## 5. Après ces actions humaines — Hard Gate rejouable ?

| Condition | Réponse |
|---|---|
| Actions A–B (D1–D7) complétées avec preuves | **Oui** — le Hard Gate **peut et doit** être rejoué |
| Uniquement config staging partielle | **Non** — P1/P5 restent en échec |
| Cleanup Phase 6 sans GO | **Toujours interdit** |

**Prérequis GO attendus après ops :** P1 (charge engine), P5 (métriques 7 j), fail-open ≈ 0, Kill off hors drill — puis validation humaine du proof.

---

## 6. Scripts disponibles (déjà dans le repo)

```bash
# Depuis apps/web
node scripts/pricing-engine-5d-ops-probe.mjs
pnpm exec tsx scripts/pricing-engine-5d-readiness.mjs
pnpm exec tsx src/lib/pricingEngine/phase5d.cutoverReadiness.test.ts
pnpm exec tsx src/lib/pricingEngine/phase2ParityHarness.ts
```

---

## 7. Synthèse une phrase

**Code + tests + readiness locale = prêts ; cutover réel = 100 % humain sur Vercel staging/prod MMD ; Hard Gate rejouable seulement après ladder D1–D7 + ≥7 jours à 100 % engine.**
