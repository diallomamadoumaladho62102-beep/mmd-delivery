# Validation Engine

## Responsibility

**Verify** quote coherence before Snapshot. **Never modify amounts.**

## Inputs

Full pre-snapshot bundle (rate, tax, fee, promo, policy, commission).

## Outputs

`IValidationResult`: `{ ok, violations[] }`.

## Mandatory invariants

1. Customer total coherent with customer lines.
2. Taxes coherent.
3. Commissions coherent.
4. Settlement contract: price immutable (checked by design + tests).
5. Snapshot immutability (post-commit tests).
6. No incoherent rule outcome.

## Errors

- `VALIDATION_FAILED` with violation codes (fail-closed → no Snapshot).

## Example

Sum of lines ≠ total → reject; no snapshot written.
