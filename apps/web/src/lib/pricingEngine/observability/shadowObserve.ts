import type { IPricingLogger, IPricingMetrics } from "./types";
import { noopPricingLogger, noopPricingMetrics } from "./types";
import type { ShadowCompareResult } from "../shadow/types";
import { defaultShadowComparer } from "../shadow/types";

export type { IPricingLogger, IPricingMetrics, PricingLogDecision, PricingMetricName } from "./types";
export { noopPricingLogger, noopPricingMetrics } from "./types";

/**
 * Record a shadow compare decision without affecting charge path.
 * Phase 0: safe no-op logger/metrics unless injected.
 */
export function recordShadowCompare(
  result: ShadowCompareResult,
  deps: {
    logger?: IPricingLogger;
    metrics?: IPricingMetrics;
  } = {}
): void {
  const logger = deps.logger ?? noopPricingLogger;
  const metrics = deps.metrics ?? noopPricingMetrics;

  logger.logDecision({
    at: result.at,
    service: result.service,
    decision: "shadow_compare",
    details: {
      equal: result.equal,
      diffCents: result.diffCents,
      legacyTotal: result.legacy.customerTotalCents,
      engineTotal: result.engine.customerTotalCents,
      currency: result.legacy.currency,
    },
  });

  if (!result.equal) {
    metrics.increment("pricing.shadow.diff_count", {
      service: result.service,
    });
  }
}

export function compareLegacyVsEngine(input: {
  service: string;
  legacyTotalCents: number;
  engineTotalCents: number;
  currency: string;
  legacyLineCount?: number;
  engineLineCount?: number;
}): ShadowCompareResult {
  return defaultShadowComparer.compare({
    service: input.service,
    legacy: {
      customerTotalCents: input.legacyTotalCents,
      currency: input.currency,
      lineCount: input.legacyLineCount ?? 0,
      source: "legacy",
    },
    engine: {
      customerTotalCents: input.engineTotalCents,
      currency: input.currency,
      lineCount: input.engineLineCount ?? 0,
      source: "engine",
    },
  });
}
