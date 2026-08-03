# Rate Engine

## Responsibility

Compute **base price only** from the applicable Rate Card and trip/cart inputs.

## Inputs

`IQuoteContext` + resolved `IRateCardRef` (params: base, per distance, per minute, class multiplier, etc.).

## Outputs

`IRateResult`: `base_amount_cents`, `lines[]`, `rate_card_ref`.

## Invariants

- No tax, fee, promo, policy, or commission lines.
- Amounts in integer cents (then currency align helpers as configured).
- Rate Card id/version always present on success.

## Errors

- `RATE_CARD_NOT_FOUND`
- `RATE_CARD_INACTIVE`
- `INVALID_DISTANCE_OR_DURATION`
- `UNSUPPORTED_CURRENCY`

## Example

Ride Standard NYC, 5.0 mi, 18 min → base = f(base, per_mile, per_minute, class) with min fare applied only if expressed as Rate Card / Rate-scoped rule — never hardcoded in code.
