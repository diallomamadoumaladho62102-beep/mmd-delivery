# Pricing Engine (Phase 0 Freeze)

Scaffolding only. See:

- `docs/architecture/pricing-engine/ADR-001-MMD-Pricing-Engine.md`
- `docs/architecture/pricing-engine/PHASE-0-FREEZE.md`

**Do not** import from live quote / checkout / settlement charge routes in Phase 0.

`resolveChargePath()` always returns `"legacy"`.
