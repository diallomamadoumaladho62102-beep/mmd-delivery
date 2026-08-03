# Commission Engine

## Responsibility

Compute **earnings splits** only: driver, restaurant, seller, platform.

## Inputs

Customer-facing bundle (post policy) + commission / share configuration (incl. Phase-4 adapter).

## Outputs

`ICommissionResult`: `earning_lines[]`, platform share.

## Invariants

- **Never mutates** `customer_total_cents`.
- Party amounts coherent under Validation rules.

## Errors

- `COMMISSION_SNAPSHOT_REQUIRED`
- `COMMISSION_RATE_UNRESOLVED`

## Example

Food subtotal × restaurant share + delivery fee × driver share → earning lines; customer total unchanged.
