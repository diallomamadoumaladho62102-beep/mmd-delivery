# Promotion Engine

## Responsibility

Apply **discounts** and record **funding** (MMD vs partner): coupons, marketing, loyalty, MMD+, shared-ride discounts.

## Inputs

Gross bundle after Rate/Tax/Fee + promo context (codes, entitlements).

## Outputs

`IPromotionResult`: `discount_total_cents`, `lines[]`, `funding[]`.

## Invariants

- Does not call Settlement.
- Stacking follows configured promo rules only.

## Errors

- `PROMO_CODE_INVALID`
- `PROMO_NOT_STACKABLE`
- `PROMO_RESERVE_FAILED` (fail-closed when code required)

## Example

Code `SAVE10` → percent discount line + funding split 100% MMD (if campaign so configured).
