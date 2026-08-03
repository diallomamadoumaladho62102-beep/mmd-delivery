# Policy Engine

## Responsibility

Apply **business policies** that are neither legal tax nor generic promotions: VIP client, driver Gold/Platinum, restaurant Premium, Marketplace Pro, enterprise, city, event, future partner tiers.

## Inputs

Actor/partner attributes + bundle after promotions.

## Outputs

`IPolicyResult`: `policy_adjustments` as explicit `lines[]` (auditable).

## Invariants

- Every adjustment is a named policy line (no silent mutation).
- Does not recompute Rate from scratch; does not invent VAT; does not call Stripe.

## Errors

- `POLICY_RULE_INVALID`
- `POLICY_SCOPE_MISMATCH`

## Example

Client VIP + policy “waive service fee” → policy line reversing/zeroing service fee contribution before Commission.
