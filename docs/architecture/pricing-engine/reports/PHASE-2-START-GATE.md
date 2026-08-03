# PHASE-2-START-GATE — Parallel Run / Shadow Compare

**Status:** **PROPOSÉ — en attente de validation humaine**  
**Ne pas démarrer** la Phase 2 tant que ce document n’est pas explicitement approuvé  
(`Phase 2 — APPROUVÉ`).

| Champ | Valeur |
|---|---|
| **ADR** | ADR-001 FINAL (figé) |
| **Phase précédente** | Phase 1 — CLÔTURÉE (2026-08-01) |
| **Charge production** | **Legacy uniquement** (inchangé pendant toute la Phase 2) |
| **Migration phase code** | Restera `PRICING_ENGINE_MIGRATION_PHASE = 1` jusqu’au démarrage validé ; passera à `2` uniquement après feu vert |

---

## 1. Objectifs

Pendant la Phase 2 uniquement :

1. **Implémenter** le Pricing Engine (Facade + Rate / Tax / Fee / Promotion / Policy / Commission / Validation) derrière les Feature Flags — **implémentation**, pas activation charge.
2. Faire tourner le moteur **en parallèle** du legacy sur un sous-ensemble d’événements quote (shadow).
3. Enregistrer les **comparaisons automatiques** Legacy vs Engine (Shadow Compare + observabilité).
4. Produire des **rapports d’écarts** exploitables (Admin / logs / métriques).
5. Préparer la confiance pour Phase 3 (Food & Package cutover) **sans** servir un seul prix client depuis l’Engine.

### Hors scope Phase 2

- Cutover Food / Package / Ride / Marketplace (Phases 3–5)
- Modification des formules métier par rapport au legacy (parity Engine ≈ Legacy)
- Settlement via Engine
- Suppression du legacy
- Canary charge (`canaryPct > 0` avec path engine) — **interdit** en Phase 2

---

## 2. Architecture (parallèle)

```text
                    Quote request (Food / Package / Taxi / Mkt)
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
            ┌───────────────┐              ┌────────────────────┐
            │ LEGACY PATH   │              │ ENGINE PATH        │
            │ (production)  │              │ (shadow only)      │
            │ Always used   │              │ If SHADOW=on &     │
            │ for response  │              │ Kill Switch=off    │
            │ & Stripe amt  │              │                    │
            └───────┬───────┘              └─────────┬──────────┘
                    │                                │
                    │ customer_total_cents           │ customer_total_cents
                    │ + line summary                 │ + line summary
                    │                                │
                    └──────────────┬─────────────────┘
                                   ▼
                         Shadow Compare
                         (diff, log, metrics)
                                   │
                                   ▼
                    Response to client = LEGACY only
```

### Chemins

| Chemin | Rôle Phase 2 |
|---|---|
| **Legacy** | Unique source de vérité pour réponse API, checkout amount, paiements |
| **Pricing Engine** | Calcul parallèle ; résultat **jamais** renvoyé au client ni à Stripe |
| **Shadow Compare** | Compare totals (+ lignes clés) ; journalise ; n’altère pas la réponse |
| **Feature Flags** | Pilotage du shadow uniquement |
| **Kill Switch** | Coupe immédiatement le shadow (et force legacy pour toute sélection future) |

### Feature Flags (Phase 2)

| Flag | Valeur cible Phase 2 | Effet |
|---|---|---|
| `PRICING_ENGINE_SHADOW` | `true` (staging d’abord, puis prod contrôlée) | Active le calcul parallèle + compare |
| `PRICING_ENGINE_KILL_SWITCH` | `false` (ops peut forcer `true`) | Désactive shadow immédiatement |
| `PRICING_ENGINE_SERVICE_*` | `false` | **Aucun** cutover service |
| `PRICING_ENGINE_CANARY_PCT` | `0` | **Aucun** trafic charge engine |
| `resolveChargePath()` | toujours `"legacy"` tant que phase &lt; 3 | Hard gate code |

### Kill Switch

`PRICING_ENGINE_KILL_SWITCH=true` ⇒ :

1. `isShadowCompareAllowed()` → `false`
2. Aucun appel Engine sur le chemin quote
3. `resolveChargePath()` → `legacy` (déjà garanti)

---

## 3. Comparaison automatique

### 3.1 Résultats comparés

Pour chaque quote shadowé (même `IQuoteContext` / inputs legacy) :

| Champ | Comparaison |
|---|---|
| `customer_total_cents` | Principal (obligatoire) |
| `currency` | Égalité stricte |
| Sous-totaux si dispo | `subtotal` / `tax` / `delivery_fee` / `service_fee` (cents) |
| Nombre de lignes | Informatif (warning si écart structure) |

Services cibles Phase 2 (ordre d’activation shadow) :

1. Food quote  
2. Package / errand quote  
3. Taxi quote  
4. Marketplace checkout shadow (déjà “shadow” métier — aligner totals)

### 3.2 Tolérances acceptées

| Devise / cas | Tolérance |
|---|---|
| USD / CAD / EUR / GBP (decimal) | **0¢** (égalité stricte) pour “parity OK” |
| Zero-decimal (GNF, XOF, …) | **0** major unit après `align` (égalité stricte post-align) |
| Lignes manquantes Engine vs Legacy | Écart **structurel** → enregistré même si total égale (warning) |

Tout `diffCents ≠ 0` = **échec de parité** pour ce sample (pas de “±1¢ OK” en Phase 2, sauf amendement ADR explicite).

### 3.3 Enregistrement des écarts

Proposition d’implémentation (après feu vert) :

| Store | Contenu |
|---|---|
| Logs structurés | `shadow_compare` via `IPricingLogger` (service, totals, diff, quote_id hash) |
| Table optionnelle `pricing_shadow_compare_logs` | id, service, legacy_total, engine_total, diff_cents, currency, equal, context_hash, created_at |
| Métriques | `pricing.shadow.diff_count`, `pricing.quote.latency_ms` (engine vs legacy) |

**PII :** pas de PII brute ; hash/anonymize user ids si loggés.

### 3.4 Rapports

- Agrégat quotidien : % equal, p50/p95 \|diff\|, top services en échec  
- Export Admin (lecture seule) ou requête SQL sur `pricing_shadow_compare_logs`  
- Critère “stable” : voir §6

---

## 4. Sécurité (confirmation)

| Garantie | Mécanisme |
|---|---|
| Engine **jamais** pour prix production en Phase 2 | `resolveChargePath` hard-gate phase &lt; 3 + flags service OFF + canary 0 |
| Seul legacy sert les utilisateurs | Réponse HTTP / intent Stripe construits **uniquement** depuis legacy |
| Shadow fail-open | Exception Engine → log error, **legacy response inchangée** |
| Mutations config | Admin only + Audit (Phase 1 table ; Audit Engine wiring Phase 2 légère OK) |
| Pas de Settlement Engine sur shadow | Interdit d’appeler SCT depuis le path shadow |

---

## 5. Rollback (désactivation Shadow)

| Niveau | Action | Délai |
|---|---|---|
| **Immédiat** | `PRICING_ENGINE_KILL_SWITCH=true` (env / secret store) | Secondes (redéploiement env selon hébergeur) |
| **Standard** | `PRICING_ENGINE_SHADOW=false` | Idem |
| **Code** | Feature flag déjà lu à chaque request ; pas de redeploy app obligatoire si env live | — |
| **Git** | Revert PR Phase 2 si bug structurel | Minutes–heures |

Après kill switch : zéro calcul Engine, zéro compare, latence quote ≈ legacy seule.

---

## 6. Validation — critères de fin de Phase 2

La Phase 2 sera **CLÔTURÉE** seulement si :

1. Pricing Engine implémenté derrière contrats ADR (Facade + sous-moteurs) avec **parity intent** vs legacy.  
2. Shadow Compare actif (au moins Food + Package en staging ; prod shadow OK après go ops).  
3. Sur un volume significatif (cible proposée) :
   - staging : ≥ **N** quotes (ex. 500) avec **≥ 99.5%** `diffCents === 0`  
   - prod shadow (si activé) : ≥ **M** quotes (ex. 2000) avec **≥ 99.5%** equal, et **0** incident charge  
4. Kill Switch testé (chaos) : shadow coupe immédiatement.  
5. `resolveChargePath` reste `"legacy"` pour 100 % des services.  
6. Rapport de fin Phase 2 livré + validation humaine.  
7. Aucun prix / paiement / commission client modifié par l’Engine.

*(N/M exacts à confirmer à l’approbation ; valeurs ci-dessus = proposition.)*

---

## 7. Risques & mitigation

| Risque | Impact | Mitigation |
|---|---|---|
| Latence double calcul (legacy + engine) | Moyen | Shadow async après réponse legacy **ou** budget timeout engine (ex. 150ms) + skip compare |
| Divergence Engine vs Legacy | Élevé pour confiance | Tolérance 0¢ ; ne jamais cutover ; corriger Engine jusqu’à parity |
| Charge accidentelle Engine | Critique | Hard gate phase &lt; 3 + tests CI `resolveChargePath === legacy` |
| Volume logs / coûts | Faible–Moyen | Sample rate optionnel (`SHADOW_SAMPLE_PCT`) ; rétention limitée |
| Couplage Next/Stripe dans Engine | Moyen | Engines purs (ports) ; pas d’import Stripe dans Rate/Tax/… |
| Exhaustion Mapbox (double call) | Moyen | Shadow réutilise distance/durée **déjà** calculées par legacy (pas de 2e Mapbox) |

---

## 8. Plan d’implémentation proposé (après feu vert uniquement)

| Étape | Contenu |
|---|---|
| 2.0 | `PRICING_ENGINE_MIGRATION_PHASE = 2` |
| 2.1 | Implémentation Facade + moteurs (parity wrappers autour legacy math / business defaults) |
| 2.2 | Hook shadow non bloquant sur Food quote (puis Package, Taxi) |
| 2.3 | Table logs + métriques |
| 2.4 | Drill Kill Switch |
| 2.5 | Rapport PHASE-2-COMPLETION |

---

## 9. Impacts attendus

| Surface | Impact Phase 2 |
|---|---|
| Utilisateurs | **Aucun** (réponses = legacy) |
| Prix / paiements / commissions | **Aucun** |
| Latence | Possible +δ ms si shadow sync ; à mesurer / mitiger |
| Ops | Nouveaux logs/métriques ; flags env |

---

## 10. Demande de décision

Merci de répondre explicitement :

- **`Phase 2 — APPROUVÉ`** — démarrage selon ce gate (éventuellement avec N/M ou sample rate ajustés)  
- **`Phase 2 — REPORTÉ`** — motifs / amendements demandés  

**Aucun développement Phase 2 ne commencera sans cette validation.**
