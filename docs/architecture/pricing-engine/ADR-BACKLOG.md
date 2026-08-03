# ADR Backlog — Pricing Engine

**Purpose:** Park ideas that must **not** enter the Pricing Engine during the ADR-001 migration.

**Rule (governance):** Phase 6 Cleanup is **COMPLÉTÉE**. Backlog items still require a future ADR (or explicit approval) before integration into the Pricing Engine — except critical bug / security fixes.

| ID | Date | Title | Proposed by | Priority | Status | Notes |
|---|---|---|---|---|---|---|
| BL-000 | 2026-08-01 | _(template)_ | — | — | open | Replace this row when filing ideas |

## How to file

1. Add a row with a new `BL-xxx` id.
2. One-line title + short notes (link to discussion if any).
3. Do **not** open implementation PRs against `pricingEngine` for backlog items.
4. After Phase 6, batch-review backlog → optional ADR-002+.

## Explicitly out of scope during migration

- New engines or pipeline reordering
- Moving responsibilities between engines
- Unrelated product pricing experiments
- UI redesigns of Admin Pricing (unless required for Phase 1 config parity)
