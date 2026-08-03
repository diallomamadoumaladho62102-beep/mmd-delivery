# Gouvernance — MMD Pricing Engine

**Architecture status:** ADR-001 FINAL — **frozen** (2026-08-01)  
**Migration status:** Phases 0–5 **CLÔTURÉES** · Hard Gate **NO GO** · Closure roadmap **APPROUVÉE** (5B→5C→5D→5E→6) · Phase 6 cleanup **REPORTÉE**  
**Engine posture:** Architecture **stable** — pas de refonte ; pas de nouvelles fonctionnalités moteur pendant la migration.  
**Active gate:** [`PHASE-5B-COMPLETION`](./reports/PHASE-5B-COMPLETION.md) — Independence livrée ; en attente validation humaine (puis START-GATE 5C).

## Rules

1. **No architecture changes** during migration except critical bug or security fix (requires explicit written approval).
2. **No roadmap changes** to Phases 0–6 without explicit human decision.
3. **No skipped steps** — phase reports and human validation remain mandatory.
4. **No new engines** and **no responsibility moves**.
5. **No new Pricing Engine features** while migration is open (through Phase 6 closure). Implementations already shipped may receive **critical bug / security** fixes only.
6. **New ideas** → [`ADR-BACKLOG.md`](./ADR-BACKLOG.md) for a future ADR revision — **not** into the live engine.
7. **Phase gate:** before starting Phase N+1, deliver the pre-start report and obtain human validation.
8. **Phase 6 REPORTÉ:** until [PHASE-6-HARD-GATE-PROOF](./reports/PHASE-6-HARD-GATE-PROOF.md) is **human-validated** and Phase 6 is **re-approved**:
   - **no** legacy code deletion
   - **no** Feature Flag removal (migration flags)
   - **no** service / table / historical engine deletion
   - **no** “simplification” that removes dual-path / fail-open / Kill Switch / Shadow
   - historical engine **remains available** per migration plan
9. **Permanent migration constraints:**
   - backward compatibility
   - never recalculate an existing Quote Snapshot
   - never mutate an already-created order’s price
   - respect ADR interfaces and SRP
   - keep Feature Flags, Kill Switch, and Shadow Compare until full validation (hard gate + Phase 6)

## Product development (outside Pricing Engine)

MMD Delivery may continue **normal product work** on other planned features.  
That work must **not** reopen Pricing Engine architecture or add PE capabilities outside ADR-001.

## Official documents

| Doc | Role |
|---|---|
| [ADR-001 FINAL](./ADR-001-MMD-Pricing-Engine.md) | Architecture of record |
| [ROADMAP](./ROADMAP.md) | Phases 0–6 |
| [FEATURE-FLAGS](./FEATURE-FLAGS.md) | Env flags (keep until hard gate) |
| [ADR-BACKLOG](./ADR-BACKLOG.md) | Deferred ideas |
| [PHASE-6-CLOSURE-ROADMAP](./reports/PHASE-6-CLOSURE-ROADMAP.md) | Feuille de route 5B→6 — **APPROUVÉE** |
| [PHASE-5B-START-GATE](./reports/PHASE-5B-START-GATE.md) | Independence — START-GATE |
| [PHASE-6-START-GATE](./reports/PHASE-6-START-GATE.md) | Cleanup — **REPORTÉ** (après 5E GO) |
| [PHASE-6-HARD-GATE-PROOF](./reports/PHASE-6-HARD-GATE-PROOF.md) | Audit Hard Gate (NO GO 2026-08-03) |
| [engines/](./engines/) | Per-engine documentation |
