/**
 * Mandatory pricing invariants (ADR-001 Final §10).
 * Enforced by Validation Engine + CI before any production cutover.
 */

export const PRICING_INVARIANT_IDS = [
  "customer_total_coherent",
  "taxes_coherent",
  "commissions_coherent",
  "settlement_never_mutates_customer_price",
  "snapshot_immutable",
  "no_incoherent_rule_outcome",
] as const;

export type PricingInvariantId = (typeof PRICING_INVARIANT_IDS)[number];
