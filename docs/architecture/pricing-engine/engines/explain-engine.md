# Explain Engine

## Responsibility

Produce a **human-readable explanation** of any price from a Snapshot (or dry-run bundle).

## Inputs

`snapshot_id` or dry-run bundle.

## Outputs

`ExplanationTree`: ordered narrative (base → distance → time → fees → taxes → promo → policy → commission → total).

## Invariants

- Read-only; never changes price.
- Snapshot is the only production SoT for explanations.

## Errors

- `SNAPSHOT_NOT_FOUND`
- `EXPLAIN_LINE_UNKNOWN`

## Example

“Why $70?” → tree of contributing lines for support and Admin.
