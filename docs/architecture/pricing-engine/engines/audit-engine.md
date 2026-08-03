# Audit Engine

## Responsibility

Historize **every configuration change**: actor, timestamp, old value, new value, reason, pricing version.

## Scope

Rate Cards, Pricing Rules, Policy Rules, Taxes, Fees, Commissions, Promotions.

## Inputs

Normalized `IAuditChange` from Admin write paths.

## Outputs

Persisted `pricing_audit_events` (Phase 1+ table; Phase 0 contract only).

## Invariants

- No silent Admin writes without audit in later phases.
- Audit does not compute prices.

## Errors

- `AUDIT_WRITE_FAILED` (fail-closed on config mutate when enforced)

## Example

Admin updates `per_mile` 1.15 → 1.25 with reason “NYC spring 2026”.
