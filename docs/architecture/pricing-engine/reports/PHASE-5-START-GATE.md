# PHASE-5-START-GATE — Marketplace Cutover / Unification

**Status:** **APPROUVÉ** (2026-08-01) — phase **CLÔTURÉE** via [PHASE-5-COMPLETION](./PHASE-5-COMPLETION.md).

| Champ | Valeur |
|---|---|
| **ADR** | ADR-001 FINAL (figé) — **aucune modification d’architecture** |
| **Phase précédente** | Phase 4 — **CLÔTURÉE** (2026-08-01) |
| **Périmètre Phase 5** | **Marketplace** uniquement |
| **Hors périmètre** | Food / Package / Ride (déjà Phases 3–4), Settlement Engine cutover, cleanup legacy (Phase 6) |
| **Migration phase code** | `PRICING_ENGINE_MIGRATION_PHASE = 5` après démarrage approuvé |
| **Nouvelles fonctionnalités** | **Interdites** — unification cutover + parity vs chemins marketplace existants |

---

## 1. Objectifs de la migration Marketplace

Pendant la Phase 5 uniquement :

1. Autoriser le Pricing Engine à servir le **chemin de charge** pour **Marketplace**, progressivement et sous Feature Flags + Canary.
2. Conserver le **moteur / chemin historique Marketplace** (y compris totaux « shadow » métier déjà en place) comme repli immédiat (Kill Switch, `SERVICE_MARKETPLACE=false`, `CANARY_PCT=0`).
3. Garantir la **parité monétaire** (tolérance **0¢**) Legacy vs Engine sur draft / checkout / charge avant d’augmenter le canary.
4. **Unifier** le calcul Marketplace derrière les contrats ADR (Rate → Tax → Fee → Promotion → Policy → Commission → Validation → Snapshot) **sans changer les formules** (ex. floor delivery fee / % déjà externalisés Phase 1).
5. Persister le **Quote Snapshot** pour les commandes Marketplace passées par l’Engine (SoT post-quote).
6. Maintenir Shadow Compare Marketplace pendant le canary ; ne pas régresser Food / Package / Ride.
7. Livrer `PHASE-5-COMPLETION.md` + validation humaine avant tout examen de la Phase 6 (cleanup legacy).

### Hors scope Phase 5

- Cleanup / suppression des chemins legacy (Phase 6)
- Modification Food / Package / Ride hors corrections de régression
- Redesign Admin Marketplace / nouvelles règles métier hors ADR
- Settlement Engine comme nouveau chemin de payout marketplace
- Changement du modèle vendeur / commission inventé (parity uniquement)

---

## 2. Périmètre de la Phase 5

| Surface | Inclus Phase 5 | Notes |
|---|---|---|
| Marketplace draft / quote totals | Oui | Selon `resolveChargePath("marketplace")` |
| Marketplace checkout / payment amount | Oui | Même règle de path ; parity 0¢ |
| Delivery fee marketplace (floor + %) | Oui | Config Phase 1 ; parity |
| Service fee / platform fee lignes checkout | Oui si déjà dans le path charge legacy | Parity |
| Seller / driver earnings lignes comparables | Oui (snapshot / compare) | Pas de nouveau split inventé |
| Food / Package / Ride charge | **Non** (inchangé Phases 3–4) | Flags inchangés hors régression |
| Tips / wallets hors checkout marketplace | **Hors scope** sauf alignement documenté | |

```text
  Marketplace quote / checkout / charge
           │
           ▼
   resolveChargePath("marketplace")
           │
     ┌─────┴──────────────────────────────┐
     │                                    │
 Food/Package/Ride (Phases 3–4)     kill / flag off / miss
     │                                    └──► LEGACY
     │
  SERVICE_MARKETPLACE + canary hit ──► ENGINE (+ Quote Snapshot)
```

---

## 3. Stratégie de migration progressive

Ordre proposé (**après** `Phase 5 — APPROUVÉ` uniquement) :

| Étape | Contenu | Trafic Engine Marketplace |
|---|---|---|
| **5.0** | `PRICING_ENGINE_MIGRATION_PHASE = 5` ; autoriser `marketplace` dans `resolveChargePath` | 0 % |
| **5.1** | `selectMarketplaceChargePath` + fail-open legacy ; Snapshot ; Shadow | 0 % (flags OFF) |
| **5.2** | Staging : `SERVICE_MARKETPLACE=true`, `CANARY_PCT` bas (1–5 %) | Staging only |
| **5.3** | Staging : paliers 5 → 25 → 50 → 100 % si parity / incidents OK | Staging |
| **5.4** | Prod : Marketplace @ canary bas, puis paliers — **aucun saut direct à 100 %** | Prod contrôlé |
| **5.5** | Stabilisation + `PHASE-5-COMPLETION.md` | Selon flags |

### Règles de progression

1. **Un levier à la fois** : activer `SERVICE_MARKETPLACE` **ou** monter `CANARY_PCT`, pas les deux le même jour sans observation.
2. **Kill Switch prioritaire** : anomalie prix / paiement Marketplace → `PRICING_ENGINE_KILL_SWITCH=true`.
3. **Fail-open** : erreur Engine sur path canary → **legacy** pour cette requête (+ log/metric).
4. Valider chaque palier **avant** le suivant (métriques, shadow, support).
5. Food / Package / Ride : ne pas dégrader volontairement ; Kill Switch global → communication ops.
6. Aucun passage à Phase 6 tant que Phase 5 n’est pas **CLÔTURÉE** par validation humaine.

---

## 4. Feature Flags

| Flag | Valeur cible Phase 5 | Effet |
|---|---|---|
| `PRICING_ENGINE_MIGRATION_PHASE` | `5` (code, après approbation) | Autorise Engine pour Marketplace **si** flag + canary |
| `PRICING_ENGINE_SERVICE_MARKETPLACE` | `false` → `true` (staging puis prod) | Autorise cutover Marketplace |
| `PRICING_ENGINE_SERVICE_FOOD` | inchangé (ops Phase 3) | Hors travaux Phase 5 |
| `PRICING_ENGINE_SERVICE_PACKAGE` | inchangé (ops Phase 3) | Hors travaux Phase 5 |
| `PRICING_ENGINE_SERVICE_RIDE` | inchangé (ops Phase 4) | Hors travaux Phase 5 |
| `PRICING_ENGINE_CANARY_PCT` | `0` → paliers (1…100) | % trafic eligible Engine (services déjà ON) |
| `PRICING_ENGINE_KILL_SWITCH` | `false` (ops peut forcer `true`) | Force **legacy** partout + coupe shadow |
| `PRICING_ENGINE_SHADOW` | `true` recommandé | Surveillance compare |
| `PRICING_ENGINE_SHADOW_SAMPLE_PCT` | ops (ex. 10–100) | Échantillonnage shadow |

### Matrice `resolveChargePath` (Phase 5 proposée)

| Condition | Résultat |
|---|---|
| Kill Switch ON | `legacy` |
| service = `marketplace` et `SERVICE_MARKETPLACE` OFF | `legacy` |
| `CANARY_PCT <= 0` | `legacy` |
| Hors bucket canary | `legacy` |
| `marketplace` + flag ON + canary hit | `engine` |
| `food` / `package` / `ride` | Inchangé vs Phases 3–4 (flags + canary) |

**Avant approbation Phase 5 :** `SERVICE_MARKETPLACE` reste OFF ; phase code reste `4` ; **aucun développement Phase 5**.

---

## 5. Règles Canary

1. **Déterministe** : hash stable (`user_id` et/ou draft / order id) — cohérence preview → paiement.
2. **Paliers recommandés** : 1 % → 5 % → 25 % → 50 % → 100 % (staging puis prod).
3. **Aucun passage direct à 100 %** en production.
4. Sans `canaryKey` et canary &lt; 100 → **legacy** (safe).
5. Shadow Compare Marketplace actif pendant les paliers (drift 0¢).
6. Critère de montée de palier (proposition) :
   - parity / shadow Marketplace **≥ 99,5 %** equal sur le volume du palier ;
   - **0** incident charge imputable à l’Engine ;
   - latence checkout dans budget ops.

---

## 6. Plan de rollback

| Niveau | Action | Effet | Délai cible |
|---|---|---|---|
| **P0 — Immédiat** | `PRICING_ENGINE_KILL_SWITCH=true` | Charge = legacy (tous services) ; shadow off | Secondes |
| **P1 — Service** | `PRICING_ENGINE_SERVICE_MARKETPLACE=false` | Coupe Engine Marketplace uniquement | Secondes |
| **P2 — Canary** | `PRICING_ENGINE_CANARY_PCT=0` | Aucun nouveau trafic Engine | Secondes |
| **P3 — Git** | Revert PR(s) Phase 5 si défaut structurel | Retour pré-Phase 5 | Minutes–heures |

### Après rollback

- Nouveaux drafts / checkouts Marketplace → Legacy.
- Commandes déjà snapshotées Engine **non recalculées** (ADR).
- Documenter l’incident **avant** toute nouvelle tentative de canary.

### Déclencheurs rollback (exemples)

- Diff monétaire client / vendeur / delivery fee
- Spike erreurs paiement checkout marketplace
- Incident support « mauvais prix » marketplace
- Latence Engine hors budget

---

## 7. Critères de validation (fin de Phase 5)

La Phase 5 sera **CLÔTURÉE** seulement si :

1. `PRICING_ENGINE_MIGRATION_PHASE = 5` et `resolveChargePath("marketplace")` peut retourner `engine` sous flags + canary.
2. Food / Package / Ride non régressés (tests + smoke).
3. Staging : canary Marketplace monté jusqu’à un palier validé ops (cible proposée : **100 % staging**) avec parity **≥ 99,5 %** et **0** incident Engine.
4. Production : paliers documentés ; Marketplace à **100 % Engine** **ou** palier explicitement accepté dans le rapport de fin.
5. Quote Snapshot Marketplace persisté pour charges Engine.
6. Unification derrière contrats ADR avec **parity** vs legacy (pas de nouvelle formule).
7. Kill Switch drill réussi ; rollback testé au moins une fois.
8. Rapport `PHASE-5-COMPLETION.md` + **validation humaine**.
9. Aucun cleanup legacy (Phase 6) effectué.

---

## 8. Risques identifiés

| ID | Risque | Impact |
|---|---|---|
| R1 | Divergence totaux Marketplace (subtotal, delivery floor/%, fees) | **Critique** |
| R2 | Confusion entre « shadow métier » historique et charge Engine | **Élevé** |
| R3 | Canary non déterministe (draft ≠ checkout) | **Élevé** |
| R4 | Erreur Engine → échec checkout au lieu de fail-open | **Élevé** |
| R5 | Kill Switch coupe aussi Food/Package/Ride | **Moyen–Élevé** (ops) |
| R6 | Double source pendant canary partiel | **Moyen** |
| R7 | Impact seller payout / perception prix | **Élevé** |
| R8 | Latence checkout marketplace | **Moyen** |

---

## 9. Mesures de mitigation

| Risque | Mitigation |
|---|---|
| R1 | Tolérance 0¢ ; Shadow + golden fixtures marketplace ; ne pas monter canary si parity &lt; seuil |
| R2 | Docs / logs `charge_path` explicites ; distinguer shadow compare vs charge Engine |
| R3 | Hash déterministe user/draft ; même clé draft → checkout |
| R4 | Fail-open legacy + alertes ; jamais bloquer paiement uniquement pour panne Engine |
| R5 | Runbook : préférer `SERVICE_MARKETPLACE=false` pour incident marketplace-only ; Kill Switch si urgence globale |
| R6 | Canary bas au démarrage ; journalisation `charge_path` |
| R7 | Comparer lignes seller/driver dans snapshot ; support runbook |
| R8 | Réutiliser montants capturés ; budget timeout → legacy |

### Rappels de gouvernance

- Aucune modification d’architecture / contrats / pipeline ADR.
- Aucune nouvelle fonctionnalité hors feuille de route.
- **Aucun développement Phase 5 avant `Phase 5 — APPROUVÉ`.**

---

## 10. Demande de décision

Merci de répondre explicitement :

- **`Phase 5 — APPROUVÉ`** — démarrage selon ce gate (paliers canary ajustables)
- **`Phase 5 — REPORTÉ`** — motifs / amendements demandés

**Aucun développement de la Phase 5 ne commencera sans cette validation.**

Jusqu’à approbation : Marketplace reste sur le **moteur historique** ; plan de migration et architecture **inchangés**.
