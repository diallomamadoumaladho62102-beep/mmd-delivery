# Pricing Simulator

## Responsibility

Run **what-if scenarios** through the **same Facade/engines** as production without impacting production charges.

## Inputs

Scenario (distance, airport, weather tags, promo, country, currency, etc.).

## Outputs

Dry-run bundle + optional Explain tree; optional `pricing_simulation_runs` row (Phase 1+).

## Invariants

- Identical engine code path as `PricingEngine.quote` with `mode=simulation`.
- Does not create live Stripe charges or production orders.

## Errors

- `SIM_SCENARIO_INVALID`
- `SIM_ENGINE_UNAVAILABLE`

## Example

26 miles + JFK + rain + promo → dry-run total for Admin review.
