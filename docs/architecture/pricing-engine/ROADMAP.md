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
| 5B | Independence (Engine = SoT calcul) | **VALIDÉ** — [COMPLETION](./reports/PHASE-5B-COMPLETION.md) | Aucun (defaults legacy) |
| 5C | Surface coverage | **VALIDÉ** — [COMPLETION](./reports/PHASE-5C-COMPLETION.md) | Aucun (defaults legacy) |
| 5D | Production cutover | **CODE+RUNBOOK** — [COMPLETION](./reports/PHASE-5D-COMPLETION.md) · [RUNBOOK](./reports/PHASE-5D-CUTOVER-RUNBOOK.md) | Ops cutover **non exécuté** |
| 5E | Hard Gate re-proof | **COMPLÉTÉE** (historique NO GO puis GO post-5F) — [PREUVE](./reports/PHASE-6-HARD-GATE-PROOF.md) | — |
| 5F | SoT hot path | **VALIDÉ** — [COMPLETION](./reports/PHASE-5F-SOT-HOT-PATH-COMPLETION.md) | PE-only happy path |
| 6 | Cleanup legacy | **COMPLÉTÉE** — [COMPLETION](./reports/PHASE-6-COMPLETION.md) · [START-GATE](./reports/PHASE-6-START-GATE.md) | Dual-path / flags / Kill / Shadow retirés |

## Post–Phase 6 (2026-08-03)

- Architecture ADR-001 : **stable** — Pricing Engine = unique moteur de calcul de charge.
- Migration dual-path : **terminée**.
- Nouvelles idées Pricing Engine → [ADR-BACKLOG](./ADR-BACKLOG.md) / nouvel ADR.
- Développement produit MMD Delivery : **autorisé** hors périmètre moteur de tarification.

## Exigences permanentes

- Compatibilité ascendante
- Snapshots immuables ; commandes existantes non recalculées
- Contrats ADR respectés
- Charge SoT = Pricing Engine only

## Gate avant chaque phase

Rapport obligatoire : objectifs · composants · risques · impacts · tests · critères de validation · plan de rollback → **validation humaine** avant démarrage.
