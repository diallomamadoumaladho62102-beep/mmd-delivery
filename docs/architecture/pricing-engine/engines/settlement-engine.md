# Settlement Engine

## Responsibility

Execute **money-out** from an immutable Quote Snapshot: Stripe Connect transfers, wallet, ledger, cashout.

## Inputs

`snapshot_id` + payment event (never a fresh recalculation).

## Outputs

Transfer plan / ledger entries / payout status updates.

## Invariants

- **Does not requote** or change customer price.
- Tips remain separate PaymentIntents as per existing money-out architecture.

## Errors

- `SNAPSHOT_NOT_FOUND`
- `SETTLEMENT_ALREADY_DONE`
- `CONNECT_ACCOUNT_NOT_READY`

## Example

Payment succeeded → SCT driver/restaurant from snapshot earning lines.
