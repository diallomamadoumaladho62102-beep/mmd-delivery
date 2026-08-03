# PHASE-4-START-GATE — Ride Cutover

**Status:** **APPROUVÉ** (2026-08-01) — phase **CLÔTURÉE** via [PHASE-4-COMPLETION](./PHASE-4-COMPLETION.md).

| Champ | Valeur |
|---|---|
| **ADR** | ADR-001 FINAL (figé) — **aucune modification d’architecture** |
| **Phase précédente** | Phase 3 — **CLÔTURÉE** (2026-08-01) |
| **Périmètre Phase 4** | **Ride (Taxi)** uniquement |
| **Hors périmètre** | Food/Package (déjà Phase 3), Marketplace (Phase 5), Settlement Engine, cleanup legacy (Phase 6) |
| **Migration phase code** | `PRICING_ENGINE_MIGRATION_PHASE = 4` après démarrage approuvé |
| **Nouvelles fonctionnalités** | **Interdites** — cutover + configurabilité ADR des règles Ride déjà prévues (parity) |

---

## 1. Objectifs de la migration Ride

Pendant la Phase 4 uniquement :

1. Autoriser le Pricing Engine à servir le **chemin de charge** pour **Ride (Taxi)**, progressivement et sous Feature Flags + Canary.
2. Conserver le **moteur historique Ride** comme chemin de repli immédiat (Kill Switch, `SERVICE_RIDE=false`, `CANARY_PCT=0`).
3. Garantir la **parité monétaire** (tolérance **0¢**) Legacy vs Engine sur quote / final price / charge avant d’augmenter le canary.
4. Brancher les **Pricing Rules Ride** prévues par l’ADR de façon **configurable** (mêmes comportements qu’aujourd’hui) : min/max fare, **surge**, **airport**, **toll**, **wait**, congestion / no-show le cas échéant — **sans inventer de nouvelles formules**.
5. Persister le **Quote Snapshot** pour les courses passées par l’Engine (SoT post-quote).
6. Maintenir Shadow Compare Ride pendant le canary ; ne pas régresser Food/Package.
7. Livrer `PHASE-4-COMPLETION.md` + validation humaine avant tout examen de la Phase 5 (Marketplace).

### Hors scope Phase 4

- Cutover **Marketplace** (Phase 5)
- Modification Food / Package hors corrections de régression
- Suppression du legacy Ride (Phase 6)
- Redesign Admin / nouvelles règles métier hors ADR
- Settlement Engine comme nouveau chemin de payout
- Tips taxi (PaymentIntent tip) sauf si strictement requis pour cohérence de charge path documentée — **par défaut hors cutover Engine**

---

## 2. Périmètre de la Phase 4

| Surface | Inclus Phase 4 | Notes |
|---|---|---|
| Taxi / Ride quote API | Oui | Montant client selon `resolveChargePath("ride")` |
| Taxi final price / drift / checkout amount | Oui | Même règle de path ; parity 0¢ |
| Wait fee / late fee liés à une course Ride | Oui (si montant inclus au charge path Ride) | Config rules ; parity vs legacy |
| Shared ride discount | Oui | Déjà config Phase 1 ; parity |
| Surge / airport / toll / congestion (schéma + règles) | Oui — **activation config parity** | Pas de nouveau modèle économique |
| Food / Package charge | **Non** (inchangé Phase 3) | Flags Food/Package restent gérés à part |
| Marketplace | **Non** | **100 % legacy** |
| Delivery `request_type=ride` (hors taxi) | **Hors scope** sauf alignement explicite documenté | Ne pas élargir sans amendement gate |

```text
  Ride quote / charge
           │
           ▼
   resolveChargePath("ride")
           │
     ┌─────┴──────────────────────────┐
     │                                │
 Food/Package (Phase 3 flags)    Marketplace
     │                                └──► LEGACY only (Phase 4)
     │
 Ride:
  kill / flag off / canary miss ──► LEGACY
  SERVICE_RIDE + canary hit ──────► ENGINE (+ Quote Snapshot)
```

---

## 3. Stratégie de migration progressive

Ordre proposé (**après** `Phase 4 — APPROUVÉ` uniquement) :

| Étape | Contenu | Trafic Engine Ride |
|---|---|---|
| **4.0** | `PRICING_ENGINE_MIGRATION_PHASE = 4` ; étendre `resolveChargePath` pour autoriser `ride` (Marketplace reste legacy) | 0 % |
| **4.1** | Adapter Ride charge path + fail-open legacy ; Snapshot Ride ; Shadow inchangé | 0 % (flags OFF) |
| **4.2** | Staging : `SERVICE_RIDE=true`, `CANARY_PCT` bas (1–5 %) | Staging only |
| **4.3** | Staging : paliers canary 5 → 25 → 50 → 100 % si parity / incidents OK | Staging |
| **4.4** | Prod : Ride @ canary bas, puis paliers — **aucun saut direct à 100 %** | Prod contrôlé |
| **4.5** | Stabilisation + `PHASE-4-COMPLETION.md` | Selon flags |

### Règles de progression

1. **Un levier à la fois** : activer `SERVICE_RIDE` **ou** monter `CANARY_PCT`, pas les deux le même jour sans observation.
2. **Kill Switch prioritaire** : anomalie prix / paiement Ride → `PRICING_ENGINE_KILL_SWITCH=true`.
3. **Fail-open** : erreur Engine sur path canary → **legacy** pour cette requête (+ log/metric).
4. Valider chaque palier (métriques, shadow parity, incidents support) **avant** le palier suivant.
5. Food/Package : ne pas baisser volontairement leur stabilité ; Kill Switch les impacte aussi — communication ops obligatoire.
6. Aucun passage à Phase 5 tant que Phase 4 n’est pas **CLÔTURÉE** par validation humaine.

---

## 4. Feature Flags

| Flag | Valeur cible Phase 4 | Effet |
|---|---|---|
| `PRICING_ENGINE_MIGRATION_PHASE` | `4` (code, après approbation) | Autorise Engine pour Ride **si** flag + canary |
| `PRICING_ENGINE_SERVICE_RIDE` | `false` → `true` (staging puis prod) | Autorise cutover Ride |
| `PRICING_ENGINE_SERVICE_FOOD` | inchangé (ops Phase 3) | Hors travaux Phase 4 |
| `PRICING_ENGINE_SERVICE_PACKAGE` | inchangé (ops Phase 3) | Hors travaux Phase 4 |
| `PRICING_ENGINE_SERVICE_MARKETPLACE` | **`false`** (obligatoire) | Marketplace reste legacy |
| `PRICING_ENGINE_CANARY_PCT` | `0` → paliers (1…100) | % trafic Ride (et autres services déjà ON) eligible Engine |
| `PRICING_ENGINE_KILL_SWITCH` | `false` (ops peut forcer `true`) | Force **legacy** partout + coupe shadow |
| `PRICING_ENGINE_SHADOW` | `true` recommandé | Surveillance compare Ride (+ autres) |
| `PRICING_ENGINE_SHADOW_SAMPLE_PCT` | ops (ex. 10–100) | Échantillonnage shadow |

### Matrice `resolveChargePath` (Phase 4 proposée)

| Condition | Résultat |
|---|---|
| Kill Switch ON | `legacy` |
| service = `marketplace` | `legacy` |
| service = `ride` et `SERVICE_RIDE` OFF | `legacy` |
| `CANARY_PCT <= 0` | `legacy` |
| Hors bucket canary | `legacy` |
| `ride` + flag ON + canary hit | `engine` |
| `food` / `package` | Inchangé vs Phase 3 (flags + canary) |

**Avant approbation Phase 4 :** `SERVICE_RIDE` reste OFF ; phase code reste `3` ; aucun développement Phase 4.

---

## 5. Règles Canary

1. **Déterministe** : hash stable (`user_id` et/ou `ride_id` / quote draft id) — même client ne bascule pas aléatoirement entre preview et paiement.
2. **Paliers recommandés** : 1 % → 5 % → 25 % → 50 % → 100 % (staging puis prod).
3. **Aucun passage direct à 100 %** en production.
4. Sans `canaryKey` et canary &lt; 100 → **legacy** (safe).
5. Shadow Compare Ride reste actif pendant les paliers (détection drift 0¢).
6. Critère de montée de palier (proposition) :
   - parity / shadow Ride **≥ 99,5 %** equal sur le volume du palier ;
   - **0** incident charge imputable à l’Engine ;
   - latence quote dans budget ops.

---

## 6. Plan de rollback

| Niveau | Action | Effet | Délai cible |
|---|---|---|---|
| **P0 — Immédiat** | `PRICING_ENGINE_KILL_SWITCH=true` | Charge = legacy (tous services) ; shadow off | Secondes |
| **P1 — Service** | `PRICING_ENGINE_SERVICE_RIDE=false` | Coupe Engine Ride uniquement | Secondes |
| **P2 — Canary** | `PRICING_ENGINE_CANARY_PCT=0` | Aucun nouveau trafic Engine | Secondes |
| **P3 — Git** | Revert PR(s) Phase 4 si défaut structurel | Retour pré-Phase 4 | Minutes–heures |

### Après rollback

- Nouvelles quotes / charges Ride → Legacy.
- Courses déjà snapshotées Engine **non recalculées** (ADR).
- Documenter l’incident **avant** toute nouvelle tentative de canary.

### Déclencheurs rollback (exemples)

- Diff monétaire client / drift quote Ride
- Spike erreurs paiement ou validation
- Incident support « mauvais prix » taxi
- Latence Engine hors budget

---

## 7. Critères de validation (fin de Phase 4)

La Phase 4 sera **CLÔTURÉE** seulement si :

1. `PRICING_ENGINE_MIGRATION_PHASE = 4` et `resolveChargePath("ride")` peut retourner `engine` sous flags + canary.
2. Marketplace reste **100 % legacy** (`SERVICE_MARKETPLACE` OFF ; tests CI).
3. Food/Package non régressés (tests + smoke).
4. Staging : canary Ride monté jusqu’à un palier validé ops (cible proposée : **100 % staging**) avec parity **≥ 99,5 %** et **0** incident Engine.
5. Production : paliers documentés ; Ride à **100 % Engine** **ou** palier explicitement accepté dans le rapport de fin.
6. Quote Snapshot Ride persisté pour charges Engine.
7. Règles surge / airport / toll / wait / congestion : **configurables**, comportement **parity** vs legacy (pas de nouvelle formule inventée).
8. Kill Switch drill réussi ; rollback testé au moins une fois.
9. Rapport `PHASE-4-COMPLETION.md` + **validation humaine**.
10. Aucun cutover Marketplace effectué.

---

## 8. Risques identifiés

| ID | Risque | Impact |
|---|---|---|
| R1 | Divergence prix Ride (base, tax, shared, wait, surge) | **Critique** |
| R2 | Activation accidentelle Marketplace | **Critique** |
| R3 | Canary non déterministe (quote ≠ charge) | **Élevé** |
| R4 | Erreur Engine → échec checkout au lieu de fail-open | **Élevé** |
| R5 | Règles airport/toll/surge présentes en schéma mais absentes / partielles en legacy → écart à l’activation config | **Élevé** |
| R6 | Kill Switch coupe aussi Food/Package en prod | **Moyen–Élevé** (ops) |
| R7 | Latence double path (Mapbox / final price) | **Moyen** |
| R8 | Confusion tip PI vs fare Engine | **Moyen** |

---

## 9. Mesures de mitigation

| Risque | Mitigation |
|---|---|
| R1 | Tolérance 0¢ ; Shadow Ride ; golden tests taxi ; ne pas monter canary si parity &lt; seuil |
| R2 | `SERVICE_MARKETPLACE` forcé OFF ; CI `resolveChargePath(marketplace) === legacy` |
| R3 | Hash déterministe user/ride draft ; même clé quote → paiement |
| R4 | Fail-open legacy + alertes ; jamais bloquer paiement uniquement pour panne Engine |
| R5 | Inventaire legacy vs règles ADR avant cutover ; n’activer que ce qui est déjà comportemental legacy (parity) ; écarts → backlog ADR, pas invention |
| R6 | Runbook : préférer `SERVICE_RIDE=false` pour incident Ride-only ; Kill Switch si urgence globale |
| R7 | Réutiliser distances/durées capturées ; budget timeout → legacy |
| R8 | Tips restent hors Engine sauf décision gate amendée ; documenter dans completion |

### Rappels de gouvernance

- Aucune modification d’architecture / contrats / pipeline ADR.
- Aucune nouvelle fonctionnalité hors feuille de route.
- **Aucun développement Phase 4 avant `Phase 4 — APPROUVÉ`.**

---

## 10. Demande de décision

Merci de répondre explicitement :

- **`Phase 4 — APPROUVÉ`** — démarrage selon ce gate (paliers canary / périmètre wait-tip ajustables)
- **`Phase 4 — REPORTÉ`** — motifs / amendements demandés

**Aucun développement de la Phase 4 ne commencera sans cette validation.**

Jusqu’à approbation : Ride reste sur le **moteur historique** ; Marketplace reste legacy ; plan de migration et architecture **inchangés**.
