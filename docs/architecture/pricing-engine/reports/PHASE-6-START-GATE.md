# PHASE-6-START-GATE — Legacy Cleanup

**Status:** **REPORTÉ** (2026-08-01) — démarrage Phase 6 **interdit** jusqu’à preuve hard gate (§0) + nouvelle approbation explicite.  
**Ne supprimer aucun** code / flag / service / table legacy pendant ce report.

| Champ | Valeur |
|---|---|
| **ADR** | ADR-001 FINAL (figé) — **aucune modification d’architecture** |
| **Phase précédente** | Phase 5 — **CLÔTURÉE** (2026-08-01) |
| **Décision** | `Phase 6 — REPORTÉ` — hard gate §0 **non satisfait** |
| **Périmètre Phase 6** | **Cleanup legacy uniquement** (retrait de chemins / code / flags redondants) |
| **Hors périmètre** | Nouveaux moteurs, nouvelles formules, Settlement cutover, redesign Admin, items ADR Backlog |
| **Migration phase code** | Reste `PRICING_ENGINE_MIGRATION_PHASE = 5` tant que Phase 6 n’est pas ré-approuvée |
| **Nouvelles fonctionnalités** | **Interdites** |
| **Rapport de preuve requis** | [PHASE-6-HARD-GATE-PROOF](./PHASE-6-HARD-GATE-PROOF.md) — à livrer **avant** toute ré-approbation |

---

## 0. Exigence préalable obligatoire (hard gate)

**Aucun composant legacy ne sera supprimé** tant que le dossier de preuve suivant n’est pas produit et **validé humainement** :

| # | Condition de preuve | Preuve attendue |
|---|---|---|
| P1 | **Toutes les verticales** (Food, Package, Ride, Marketplace) utilisent le Pricing Engine en charge | Ops : `SERVICE_*=true` + `CANARY_PCT=100` (ou équivalent documenté) **en staging puis prod** ; métriques `charge_path=engine` ; échantillons SQL / logs |
| P2 | **Aucun appel de production** ne dépend encore du moteur historique pour le montant charge | Audit code + telemetry : `resolveChargePath` → `engine` à 100 % (hors Kill Switch d’urgence) ; absence de montants Stripe issus d’un path legacy parallèle |
| P3 | Les **Feature Flags de migration** peuvent être retirés **sans impact** | Plan de retrait flags + dry-run staging ; prix / paiements inchangés sur golden + smoke |
| P4 | **Tests de régression** entièrement réussis | Suites pricing Phase 0–5 + delivery/taxi/marketplace checkout + CI ciblée — **verts** |
| P5 | **Métriques de production** conformes | Parity/shadow residual OK ; 0 incident charge Engine imputable ; latence dans budget ; Kill Switch non requis hors drill |

Tant que P1–P5 ne sont pas démontrés, la Phase 6 reste en **mode inventaire / préparation uniquement** — **zéro suppression**.

> **État actuel (post–Phase 5 code) :** les défauts env gardent encore **canary 0 / service flags OFF** → charge **legacy** jusqu’à activation ops. Les adapters Engine restent en **parity wrappers** autour du calcul historique. Le cleanup ne peut donc **pas** commencer sur la seule clôture documentaire de Phase 5.

---

## 1. Objectifs de la Phase 6 (Cleanup)

Après validation du dossier de preuve (§0) et `Phase 6 — APPROUVÉ` :

1. Retirer progressivement les **chemins legacy redondants** devenus morts une fois Engine = unique charge path.
2. Simplifier le pilotage (flags de migration devenus inutiles) **sans** changer les formules métier.
3. Nettoyer le code / UI clairement **incorrect ou fantôme** (ex. faux −5 % DriverPayout documenté Phase 1).
4. Conserver la **compatibilité ascendante** : snapshots immuables ; commandes historiques non recalculées.
5. Livrer `PHASE-6-COMPLETION.md` + validation humaine = fin du plan de migration ADR-001 (hors backlog).

### Hors scope Phase 6

- Nouvelle architecture / nouveaux contrats / nouveau pipeline
- Settlement Engine comme cutover payout
- Refonte Admin Pricing
- Intégration ADR Backlog (sauf bug critique / sécurité — gouvernance)
- Réinvention de formules « pendant qu’on y est »

---

## 2. Périmètre exact du nettoyage

| Inclus | Exclu |
|---|---|
| Code / branches charge **legacy** devenues inatteignables après preuve P1–P2 | Tables / seeds config encore SoT Engine |
| Flags migration obsolètes (après P3) | Kill Switch **tant que** ops le exige encore (décision explicite dans completion) |
| Shadow Compare **charge-path dual** si plus nécessaire (après stabilité) | Historique `pricing_shadow_compare_logs` / snapshots (rétention audit) |
| UI / previews faux calculs documentés | Mobile apps hors repo sans inventaire dédié |
| Moteurs / modules **shadow-only** redondants si Engine unique | Settlement, tips hors fare, wallets |

---

## 3. Liste des composants legacy candidats à suppression

Inventaire **provisoire** (à confirmer dans le dossier de preuve ; rien n’est supprimé avant P1–P5) :

| ID | Composant / zone | Nature |
|---|---|---|
| L1 | Branches `chargePath === "legacy"` dans `select*ChargePath` + fail-open legacy | Dual path cutover |
| L2 | `resolveChargePath` canary / `SERVICE_*` / `CANARY_PCT` (simplification post-migration) | Feature flags migration |
| L3 | `PRICING_ENGINE_SHADOW` + runner shadow sur quotes (si dual compare devenu inutile) | Observabilité migration |
| L4 | Harness / tests de migration Phase 2–5 devenus redondants (garder un sous-ensemble régression) | Tests |
| L5 | UI faux calcul `DriverPayout` −5 % / pages earnings fantômes | UX incorrecte (Phase 1 backlog → Phase 6) |
| L6 | Heuristiques / moteurs **delivery V2 shadow** non charge (`deliveryPricingEngine` coeffs shadow) si doublon Engine | Shadow-only |
| L7 | Mirrors hardcodés mobile / preview client (si encore hors SoT serveur) | Drift client |
| L8 | Nommage / champs `checkout_shadow` marketplace purement migration (rename ou consolidation doc) | Clarification (pas forcément delete) |
| L9 | Documentation « charge = legacy by default » une fois Engine permanent | Docs |

**Non candidats** (sauf décision contraire explicite) : `pricing_business_defaults`, Rate Cards / `taxi_pricing`, Quote Snapshots, table shadow logs (archive), Kill Switch (jusqu’à décision ops).

---

## 4. Justification de chaque suppression

| ID | Justification |
|---|---|
| L1 | Une fois Engine = unique path prod, le dual path augmente la surface de bug et la confusion ops |
| L2 | Flags de migration n’ont plus de rôle si cutover terminé et prouvé |
| L3 | Coût latence/logs ; Shadow était un outil de confiance pre-cutover |
| L4 | Réduire bruit CI ; conserver golden parity Engine |
| L5 | Calcul UI faux → risque support / confiance chauffeur |
| L6 | Éviter deux « vérités » delivery non charge |
| L7 | Preview ≠ charge → plaintes prix |
| L8 | Clarté « shadow métier » vs Engine |
| L9 | Docs alignées sur l’état réel |

Chaque item L* devra avoir une **fiche preuve « 0 dépendance prod »** avant merge de suppression.

---

## 5. Confirmation qu’aucune dépendance active ne subsiste

Avant chaque suppression L* :

1. Recherche statique (références TS/SQL/routes).  
2. Telemetry prod : 0 hit path legacy sur fenêtre W (ex. 7–14 jours).  
3. Revue checklist verticale Food / Package / Ride / Marketplace.  
4. Sign-off ops + engineering sur la fiche L*.

**Sans cette confirmation → pas de merge delete.**

---

## 6. Stratégie de suppression progressive

Ordre proposé (**après** preuve §0 + `Phase 6 — APPROUVÉ`) :

| Étape | Contenu | Suppression code ? |
|---|---|---|
| **6.0** | `PRICING_ENGINE_MIGRATION_PHASE = 6` ; dossier preuve P1–P5 archivé | Non |
| **6.1** | Feature freeze cleanup ; inventaire L* figé | Non |
| **6.2** | Staging : Engine-only (flags retirés en staging) + régression | Non (config) |
| **6.3** | Prod : Engine-only confirmé ; période observation | Non |
| **6.4** | Suppressions L5 / L7 (safe UX / preview) en premier | Oui (faible risque) |
| **6.5** | Retrait flags migration L2 (si P3 OK) | Oui |
| **6.6** | Retrait dual path L1 + simplification fail-open | Oui |
| **6.7** | Shadow dual L3 / V2 shadow L6 (si prouvé inutile) | Oui |
| **6.8** | `PHASE-6-COMPLETION.md` | — |

**Règle :** une PR de suppression = **un** cluster L* (ou sous-ensemble) + rollback plan + tests.

---

## 7. Plan de rollback si dépendance oubliée

| Niveau | Action | Effet |
|---|---|---|
| **P0** | `PRICING_ENGINE_KILL_SWITCH=true` **si encore présent** | Force legacy immédiat (si path legacy encore déployé) |
| **P1** | Revert git de la PR cleanup | Restaure composants |
| **P2** | Réactiver flags migration (`SERVICE_*`, canary) depuis backup env | Retour path dual |
| **P3** | Hotfix doc + incident report | Bloque suite des deletes |

Si le legacy a déjà été **physiquement supprimé** et qu’une dépendance apparaît :

1. **Revert / restore** immédiat (git ou artefact release précédent).  
2. **Ne pas** « réinventer » un legacy partiel.  
3. Documenter la dépendance manquée → mettre à jour l’inventaire L* → rejouer preuve P1–P2.

---

## 8. Critères de validation (fin de Phase 6)

La Phase 6 sera **CLÔTURÉE** seulement si :

1. Dossier de preuve §0 (P1–P5) **approuvé** et archivé.  
2. Inventaire L* traité (supprimé **ou** explicitement reporté avec justification).  
3. Aucune verticale ne charge via un path legacy parallèle en prod.  
4. Flags migration retirés **ou** décision écrite de les conserver temporairement.  
5. Régression + smoke post-cleanup **verts**.  
6. Pas de changement de formule / architecture / contrats.  
7. `PHASE-6-COMPLETION.md` + **validation humaine**.  
8. ADR-001 migration plan considéré **terminé** (backlog hors scope).

---

## 9. Risques identifiés

| ID | Risque | Impact |
|---|---|---|
| R1 | Suppression prématurée alors que canary prod &lt; 100 % | **Critique** |
| R2 | Dépendance cachée (cron, mobile, admin preview) | **Élevé** |
| R3 | Retrait Kill Switch trop tôt | **Élevé** |
| R4 | Confusion Shadow métier marketplace vs Engine | **Moyen** |
| R5 | Régression prix après delete dual path | **Critique** |
| R6 | Scope creep (refacto hors cleanup) | **Élevé** |

---

## 10. Mesures de mitigation

| Risque | Mitigation |
|---|---|
| R1 | Hard gate §0 ; **zéro delete** sans preuve |
| R2 | Inventaire multi-surface + période observation prod + recherche références |
| R3 | Kill Switch retiré seulement sur décision ops explicite dans completion |
| R4 | Docs + renommage prudent (L8) sans changer montants |
| R5 | Golden parity avant/après chaque PR ; canary observation ; revert git |
| R6 | Checklist PR « cleanup only » ; refus de nouvelles features |

### Rappels de gouvernance

- ADR-001 FINAL = architecture de référence.  
- Aucune nouvelle fonctionnalité.  
- **Aucun développement Phase 6 (y compris deletes) avant `Phase 6 — APPROUVÉ`.**  
- Même après approbation : **pas de delete** avant preuve P1–P5.

---

## 11. Demande de décision

**Décision reçue :** `Phase 6 — REPORTÉ` (2026-08-01).

Pendant le report :

- moteur historique **disponible** (plan de migration) ;
- **aucune** suppression de code legacy ;
- **aucune** suppression de Feature Flags ;
- **aucune** suppression de services ;
- **aucune** suppression de tables.

**Prochaine étape :** livrer [PHASE-6-HARD-GATE-PROOF](./PHASE-6-HARD-GATE-PROOF.md) lorsque P1–P5 sont **réellement** satisfaits.  
Ce n’est qu’après **validation humaine** de ce rapport de preuve que la Phase 6 pourra être **ré-approuvée** (`Phase 6 — APPROUVÉ`).

Jusqu’à cette double validation (preuve + APPROUVÉ) : **aucun cleanup code** ; plan de migration et architecture **inchangés**.
