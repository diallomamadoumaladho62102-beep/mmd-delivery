# PHASE-3-START-GATE — Food & Package Cutover

**Status:** **APPROUVÉ** (2026-08-01) — phase **CLÔTURÉE** via [PHASE-3-COMPLETION](./PHASE-3-COMPLETION.md).

| Champ | Valeur |
|---|---|
| **ADR** | ADR-001 FINAL (figé) |
| **Phase précédente** | Phase 2 — **CLÔTURÉE** (2026-08-01) |
| **Périmètre Phase 3** | **Food** et **Package** uniquement |
| **Hors périmètre** | Ride, Marketplace, Settlement Engine, cleanup legacy |
| **Migration phase code** | `PRICING_ENGINE_MIGRATION_PHASE = 3` après démarrage approuvé |

---

## 1. Objectifs de la Phase 3

Pendant la Phase 3 uniquement :

1. Autoriser le Pricing Engine à servir le **chemin de charge** pour **Food** et **Package**, progressivement et sous Feature Flags.
2. Conserver le **moteur historique** comme chemin de repli immédiat (Kill Switch + flags service OFF).
3. Garantir la **parité monétaire** (tolérance **0¢**) entre Engine et Legacy sur les surfaces cutover avant d’augmenter le canary.
4. Persister le **Quote Snapshot** (SoT post-quote) pour les commandes Food / Package passées par l’Engine, conformément à l’ADR.
5. Maintenir Shadow Compare actif (au moins Ride / Marketplace hors cutover ; Food/Package en surveillance pendant canary).
6. Livrer un rapport `PHASE-3-COMPLETION.md` + validation humaine avant tout examen de la Phase 4 (Ride).

### Hors scope Phase 3

- Cutover **Ride** (Phase 4)
- Cutover **Marketplace** (Phase 5)
- Suppression / cleanup du legacy (Phase 6)
- Modification des formules métier (parity intent inchangé vs Phase 2)
- Settlement Engine comme nouveau chemin de payout
- Activation canary / service flags pour Ride ou Marketplace

---

## 2. Périmètre concerné (Food et Package)

| Surface | Inclus Phase 3 | Notes |
|---|---|---|
| Food quote API | Oui | Montant client / intent peuvent venir de l’Engine si flags + canary |
| Food checkout / payment amount | Oui | Même règle `resolveChargePath("food")` |
| Package / errand quote API | Oui | Idem `resolveChargePath("package")` |
| Package payment amount | Oui | Idem |
| Taxi / Ride quote & charge | **Non** | Reste **100 % legacy** |
| Marketplace checkout & charge | **Non** | Reste **100 % legacy** (path métier shadow existant inchangé côté charge Engine) |
| Tips / wait fees / no-show taxi | **Non** | Hors Food/Package cutover |
| Admin Rate Cards / config | Lecture seule / config déjà Phase 1 | Pas de redesign Admin |

```text
  Quote / charge request
           │
           ▼
   resolveChargePath(service)
           │
     ┌─────┴──────┐
     │            │
 Food/Package   Ride / Marketplace
 flags+canary     │
     │            └──► LEGACY only (Phase 3)
     │
     ├── canary miss / kill / flag off ──► LEGACY
     └── canary hit + service on ───────► ENGINE (+ Quote Snapshot)
```

---

## 3. Stratégie de migration progressive

Ordre proposé (après `Phase 3 — APPROUVÉ` uniquement) :

| Étape | Contenu | Trafic Engine |
|---|---|---|
| **3.0** | `PRICING_ENGINE_MIGRATION_PHASE = 3` ; câbler `resolveChargePath` pour Food/Package uniquement (Ride/Marketplace restent legacy) | 0 % |
| **3.1** | Staging : `SERVICE_FOOD` / `SERVICE_PACKAGE` ON, `CANARY_PCT` bas (ex. 1–5 %) | Staging only |
| **3.2** | Staging : monter canary par paliers (ex. 5 → 25 → 50 → 100 %) si parity et incidents OK | Staging |
| **3.3** | Prod : activer Food d’abord à canary bas ; Package ensuite (ou en parallèle à canary encore plus bas) | Prod contrôlé |
| **3.4** | Prod : paliers canary Food puis Package jusqu’à 100 % **par service** | Prod |
| **3.5** | Stabilisation + `PHASE-3-COMPLETION.md` | Selon flags |

### Règles de progression

1. **Un seul levier à la fois** recommandé : soit monter `CANARY_PCT`, soit activer un service flag — pas les deux le même jour sans observation.
2. **Kill Switch prioritaire** : toute anomalie prix / paiement → `PRICING_ENGINE_KILL_SWITCH=true` (retour immédiat legacy pour tous les services).
3. **Fail-closed charge Engine** : erreur Engine sur path canary → **legacy** pour cette requête (pas d’échec paiement pour cause Engine), + log/metric.
4. Shadow Compare **reste** disponible pour détecter drift pendant le canary (sample configurable).
5. Aucun passage à Phase 4 tant que Phase 3 n’est pas **CLÔTURÉE** par validation humaine.

### Canary (sélection)

Proposition (implémentation après feu vert) : sélection déterministe (hash user_id ou order draft id) afin qu’un même client ne bascule pas aléatoirement entre Legacy et Engine au sein d’une session de checkout.

---

## 4. Feature Flags utilisés

| Flag | Valeur cible Phase 3 | Effet |
|---|---|---|
| `PRICING_ENGINE_MIGRATION_PHASE` | `3` (code, après approbation) | Autorise Engine pour charge **si** flags service + canary |
| `PRICING_ENGINE_SERVICE_FOOD` | `false` → `true` (staging puis prod) | Autorise cutover Food |
| `PRICING_ENGINE_SERVICE_PACKAGE` | `false` → `true` (staging puis prod) | Autorise cutover Package |
| `PRICING_ENGINE_SERVICE_RIDE` | **`false`** (obligatoire) | Ride reste legacy |
| `PRICING_ENGINE_SERVICE_MARKETPLACE` | **`false`** (obligatoire) | Marketplace reste legacy |
| `PRICING_ENGINE_CANARY_PCT` | `0` → paliers (1…100) | % du trafic Food/Package eligible vers Engine |
| `PRICING_ENGINE_KILL_SWITCH` | `false` (ops peut forcer `true`) | Force **legacy** partout + coupe shadow |
| `PRICING_ENGINE_SHADOW` | `true` recommandé | Continue la surveillance compare |
| `PRICING_ENGINE_SHADOW_SAMPLE_PCT` | ops (ex. 10–100) | Échantillonnage shadow |

### Matrice `resolveChargePath` (Phase 3)

| Condition | Résultat |
|---|---|
| Kill Switch ON | `legacy` |
| service ∉ {food, package} | `legacy` |
| `SERVICE_*` OFF pour le service | `legacy` |
| `CANARY_PCT <= 0` | `legacy` |
| Hors bucket canary | `legacy` |
| Food/Package + flag ON + canary hit | `engine` |

**Avant approbation Phase 3 :** aucun de ces flags de cutover ne doit être activé en production ; phase code reste `2`.

---

## 5. Plan de rollback

| Niveau | Action | Effet | Délai cible |
|---|---|---|---|
| **P0 — Immédiat** | `PRICING_ENGINE_KILL_SWITCH=true` | Charge = legacy (tous services) ; shadow off | Secondes (selon propagation env) |
| **P1 — Service** | `PRICING_ENGINE_SERVICE_FOOD=false` et/ou `…_PACKAGE=false` | Coupe Engine pour le(s) vertical(s) | Secondes |
| **P2 — Canary** | `PRICING_ENGINE_CANARY_PCT=0` | Aucun nouveau trafic Engine | Secondes |
| **P3 — Git** | Revert PR(s) Phase 3 si défaut structurel | Retour comportement pré-Phase 3 | Minutes–heures |

### Après rollback

- Les **nouvelles** quotes / charges utilisent Legacy.
- Les commandes déjà snapshotées Engine **ne sont pas recalculées** (compatibilité ADR : snapshot immuable).
- Paiements en cours : montants déjà figés sur l’intent / snapshot restent ceux capturés au moment du quote.

### Critères de déclenchement rollback (exemples)

- Diff monétaire client détecté vs baseline legacy / shadow
- Spike erreurs paiement / validation quote Engine
- Incident support « mauvais prix » Food ou Package
- Latence quote Engine hors budget ops

---

## 6. Critères de validation (fin de Phase 3)

La Phase 3 sera **CLÔTURÉE** seulement si :

1. `PRICING_ENGINE_MIGRATION_PHASE = 3` et `resolveChargePath` peut retourner `engine` **uniquement** pour Food et Package sous flags + canary.
2. Ride et Marketplace restent **100 % legacy** pendant toute la phase (`SERVICE_RIDE` / `SERVICE_MARKETPLACE` OFF ; tests CI).
3. Staging : canary Food + Package monté jusqu’à un palier validé ops (cible proposée : **100 % staging**) avec :
   - parity / shadow **≥ 99,5 %** equal (0¢) sur volume significatif ;
   - **0** incident charge imputable à l’Engine.
4. Production : canary progressif documenté ; Food et Package à **100 % Engine** **ou** palier explicitement accepté dans le rapport de fin (avec justification).
5. Quote Snapshot persisté pour les charges Engine Food/Package (champs ADR : version + montants).
6. Kill Switch drill réussi en staging (et procédure ops prod documentée).
7. Rollback testé au moins une fois (Kill Switch ou `CANARY_PCT=0`) avec retour legacy vérifié.
8. Rapport `PHASE-3-COMPLETION.md` livré + **validation humaine**.
9. Aucun cutover Ride / Marketplace effectué.

*(Paliers canary exacts et seuils d’incident à confirmer à l’approbation.)*

---

## 7. Risques identifiés

| ID | Risque | Impact |
|---|---|---|
| R1 | Divergence de prix Engine vs Legacy sur un sous-ensemble Food/Package | **Critique** (confiance client / support) |
| R2 | Activation accidentelle Ride ou Marketplace | **Critique** (hors périmètre) |
| R3 | Canary non déterministe → montant différent entre preview et paiement | **Élevé** |
| R4 | Erreur Engine → échec checkout au lieu de fallback legacy | **Élevé** |
| R5 | Snapshot manquant / incomplet → litiges settlement ultérieurs | **Élevé** |
| R6 | Latence Engine dégrade conversion quote | **Moyen** |
| R7 | Confusion ops (SHADOW vs charge Engine) | **Moyen** |
| R8 | Double source de vérité pendant canary partiel | **Moyen** (attendu ; à maîtriser) |

---

## 8. Mesures de mitigation

| Risque | Mitigation |
|---|---|
| R1 | Tolérance 0¢ ; Shadow + métriques pendant canary ; rollback Kill Switch ; ne pas monter le canary si parity &lt; seuil |
| R2 | Flags Ride/Marketplace forcés OFF ; tests CI `resolveChargePath(ride\|marketplace) === legacy` ; revue gate |
| R3 | Hash déterministe (user / draft) ; même path quote → charge pour un bucket |
| R4 | Fail-open vers Legacy sur erreur Engine ; alertes ; jamais bloquer le paiement uniquement pour panne Engine |
| R5 | Snapshot obligatoire avant création PaymentIntent Engine ; tests d’invariant |
| R6 | Budgets latence ; feature flags ; option timeout → legacy |
| R7 | Docs Feature Flags Phase 3 ; Runbook kill/canary ; distinction claire Shadow vs Charge |
| R8 | Canary bas au démarrage ; un service à la fois si besoin ; journalisation `charge_path` sur chaque quote |

### Sécurité / conformité (rappel)

- Kill Switch = chemin de sortie unique et immédiat.
- Pas de recalcul des commandes historiques.
- Pas de changement de formule métier hors parity.
- Aucun développement Phase 3 **avant** `Phase 3 — APPROUVÉ`.

---

## 9. Demande de décision

Merci de répondre explicitement :

- **`Phase 3 — APPROUVÉ`** — démarrage selon ce gate (éventuellement avec paliers canary / ordre Food→Package ajustés)
- **`Phase 3 — REPORTÉ`** — motifs / amendements demandés

**Aucun développement de la Phase 3 ne commencera sans cette validation.**

Jusqu’à approbation : le **moteur historique reste la seule source de production** ; aucun trafic réel vers le Pricing Engine.
