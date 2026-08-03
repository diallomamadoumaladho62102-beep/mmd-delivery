# Gouvernance — MMD Pricing Engine

**Architecture status:** ADR-001 FINAL — **frozen** (2026-08-01)  
**Migration status:** Phases 0–5 **CLÔTURÉES** · 5B–5F **VALIDÉES** · Phase 6 cleanup **COMPLÉTÉE** — migration charge **terminée**  
**Engine posture:** Pricing Engine = **unique moteur de calcul de charge** ; ADR-001 frozen.  
**Active gate:** migration dual-path **fermée** — voir [`PHASE-6-COMPLETION`](./reports/PHASE-6-COMPLETION.md).

## Rules

1. **No architecture changes** during migration except critical bug or security fix (requires explicit written approval).
2. **No roadmap changes** to Phases 0–6 without explicit human decision.
3. **No skipped steps** — phase reports and human validation remain mandatory.
4. **No new engines** and **no responsibility moves**.
5. **New Pricing Engine capabilities** require a new ADR (or backlog → ADR). Critical bug / security fixes allowed.
6. **New ideas** → [`ADR-BACKLOG.md`](./ADR-BACKLOG.md) for a future ADR revision — **not** into the live engine without ADR.
7. **Phase gate:** historical — Phases 0–6 closed; future PE work uses ADR process.
8. **Phase 6 COMPLÉTÉE:** dual-path / migration flags / Kill Switch / Shadow Compare **retirés**. Voir [PHASE-6-COMPLETION](./reports/PHASE-6-COMPLETION.md).
9. **Permanent constraints:**
   - backward compatibility
   - never recalculate an existing Quote Snapshot
   - never mutate an already-created order’s price
   - respect ADR interfaces and SRP
   - charge SoT = Pricing Engine only

## Product development (outside Pricing Engine)

MMD Delivery may continue **normal product work** on other planned features.  
That work must **not** reopen Pricing Engine architecture or add PE capabilities outside ADR-001.

## Official documents

| Doc | Role |
|---|---|
| [ADR-001 FINAL](./ADR-001-MMD-Pricing-Engine.md) | Architecture of record |
| [ROADMAP](./ROADMAP.md) | Phases 0–6 |
| [FEATURE-FLAGS](./FEATURE-FLAGS.md) | Migration flags — **RETIRÉS** Phase 6 |
| [ADR-BACKLOG](./ADR-BACKLOG.md) | Deferred ideas |
| [PHASE-6-CLOSURE-ROADMAP](./reports/PHASE-6-CLOSURE-ROADMAP.md) | Feuille de route 5B→6 — **APPROUVÉE** |
| [PHASE-5B-COMPLETION](./reports/PHASE-5B-COMPLETION.md) | Independence — **VALIDÉ** |
| [PHASE-5C-COMPLETION](./reports/PHASE-5C-COMPLETION.md) | Surface coverage — **VALIDÉ** |
| [PHASE-5D-COMPLETION](./reports/PHASE-5D-COMPLETION.md) | Cutover — code+runbook |
| [PHASE-5E-COMPLETION](./reports/PHASE-5E-COMPLETION.md) | Hard Gate re-proof (historique) |
| [PHASE-5F-SOT-HOT-PATH-COMPLETION](./reports/PHASE-5F-SOT-HOT-PATH-COMPLETION.md) | SoT hot path — **VALIDÉ** |
| [PHASE-6-START-GATE](./reports/PHASE-6-START-GATE.md) | Cleanup — **APPROUVÉ** |
| [PHASE-6-HARD-GATE-PROOF](./reports/PHASE-6-HARD-GATE-PROOF.md) | Audit Hard Gate — **GO** |
| [PHASE-6-COMPLETION](./reports/PHASE-6-COMPLETION.md) | Cleanup — **COMPLÉTÉE** |
| [engines/](./engines/) | Per-engine documentation |
