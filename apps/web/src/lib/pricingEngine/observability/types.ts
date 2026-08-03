/**
 * Observability ports — Phase 0 (no production wiring).
 * Implementations must not alter pricing math.
 */

export type PricingLogDecision = {
  at: string;
  service: string;
  decision:
    | "quote_start"
    | "rate_card_selected"
    | "rule_applied"
    | "policy_applied"
    | "validation_pass"
    | "validation_fail"
    | "snapshot_committed"
    | "shadow_compare"
    | "charge_path_legacy"
    | "charge_path_engine";
  details?: Record<string, unknown>;
};

export type PricingMetricName =
  | "pricing.quote.latency_ms"
  | "pricing.shadow.diff_cents"
  | "pricing.shadow.diff_count"
  | "pricing.validation.fail_count"
  | "pricing.quote.error_count";

export interface IPricingLogger {
  logDecision(event: PricingLogDecision): void;
}

export interface IPricingMetrics {
  increment(name: PricingMetricName, tags?: Record<string, string>): void;
  timing(
    name: "pricing.quote.latency_ms",
    ms: number,
    tags?: Record<string, string>
  ): void;
}

/** No-op defaults for Phase 0 (safe if accidentally constructed). */
export const noopPricingLogger: IPricingLogger = {
  logDecision() {},
};

export const noopPricingMetrics: IPricingMetrics = {
  increment() {},
  timing() {},
};
