# Fee Engine

## Responsibility

Emit **independent fee lines** driven by Pricing Rules (airport, toll, parking, waiting, cleaning, congestion, booking, service fee, etc.).

## Inputs

`IQuoteContext` + prior `IRateResult` (+ optional tax context for display only).

## Outputs

`IFeeResult`: `fee_total_cents`, `lines[]` (one line per applied fee).

## Invariants

- Disabled rules produce **no** line (not a zero hardcode in code).
- Does not compute base fare or discounts.

## Errors

- `FEE_RULE_INVALID_PARAMS`
- `FEE_RULE_CONFLICT` (priority resolution failure)

## Example

Airport pickup at JFK with Airport Rule enabled → `airport_fee` line from rule params.
