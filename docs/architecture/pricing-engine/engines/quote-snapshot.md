# Quote Snapshot

## Responsibility

Persist the **immutable** validated quote as Source of Truth.

## Inputs

Validated bundle only (`IValidationResult.ok === true`).

## Outputs

`IQuoteSnapshot` with versions, lines, totals, inputs.

## Invariants

- Immutable after commit.
- Existing orders never recalculated when config changes.
- No snapshot without Validation pass.

## Errors

- `VALIDATION_REQUIRED`
- `SNAPSHOT_PERSIST_FAILED`

## Example

Validated food quote → snapshot id referenced by checkout intent / order.
