# Feuille de route officielle — MMD Pricing Engine

Conforme à **ADR-001 FINAL**. Aucun écart d’architecture.

| Phase | Nom | Statut | Changement user / prix / paiement |
|---|---|---|---|
| −1 | Architecture ADR | **Done** | Aucun |
| **0** | Freeze | **Done** | Aucun |
| **1** | Configuration | **CLÔTURÉE** | Aucun (parity) |
| **2** | Parallel Run / Shadow | **CLÔTURÉE** — [COMPLETION](./reports/PHASE-2-COMPLETION.md) | Charge = legacy |
| **3** | Food & Package cutover | **CLÔTURÉE** — [COMPLETION](./reports/PHASE-3-COMPLETION.md) | Flags + canary + rollback |
| **4** | Ride cutover | **CLÔTURÉE** — [COMPLETION](./reports/PHASE-4-COMPLETION.md) | Flags + canary + rollback |
| **5** | Marketplace cutover | **CLÔTURÉE** — [COMPLETION](./reports/PHASE-5-COMPLETION.md) | Flags + canary + rollback |
| 5B | Independence (Engine = SoT calcul) | **COMPLETION livré** — [START-GATE](./reports/PHASE-5B-START-GATE.md) · [COMPLETION](./reports/PHASE-5B-COMPLETION.md) | En attente `Phase 5B — VALIDÉ` |
| 5C | Surface coverage | Planifié — [CLOSURE-ROADMAP](./reports/PHASE-6-CLOSURE-ROADMAP.md) | Après 5B validé |
| 5D | Production cutover | Planifié | Après 5C validé |
| 5E | Hard Gate re-proof | Planifié | Après 5D validé |
| 6 | Cleanup legacy | **REPORTÉ** — hard gate NO GO ; cleanup après 5E GO — [START-GATE](./reports/PHASE-6-START-GATE.md) · [PREUVE](./reports/PHASE-6-HARD-GATE-PROOF.md) · [ROADMAP](./reports/PHASE-6-CLOSURE-ROADMAP.md) **APPROUVÉE** | Interdit jusqu’à 5E GO + ré-approbation Phase 6 |

## Gel post–Phase 5 (2026-08-01)

- Architecture ADR-001 : **stable** — pas de refonte Pricing Engine.
- Feuille de route Phases 0–6 : **inchangée**.
- Closure roadmap **APPROUVÉE** (5B→5C→5D→5E→6) — aucune implémentation sans START-GATE + approbation par phase.
- Phase 6 : **REPORTÉE** — aucun cleanup / delete / simplification legacy jusqu’à 5E GO + approbation Phase 6.
- Nouvelles idées Pricing Engine → [ADR-BACKLOG](./ADR-BACKLOG.md) uniquement.
- Développement produit MMD Delivery : **autorisé** hors périmètre moteur de tarification.

## Exigences permanentes (toutes phases)

- Compatibilité ascendante
- Snapshots immuables ; commandes existantes non recalculées
- Contrats ADR respectés
- Feature Flags + Kill Switch + Shadow Compare jusqu’à validation hard gate + Phase 6

## Gate avant chaque phase

Rapport obligatoire : objectifs · composants · risques · impacts · tests · critères de validation · plan de rollback → **validation humaine** avant démarrage.
