/**
 * Pricing Engine feature flags — Phase 0.
 * Defaults keep 100% legacy charge path. Kill switch forces legacy when enabled.
 */

import { resolveChargePathForPhase } from "./killSwitch";
import type {
  ChargePath,
  PricingEngineFlags,
  PricingEngineService,
} from "./flagTypes";

export type {
  ChargePath,
  PricingEngineFlags,
  PricingEngineService,
} from "./flagTypes";

function readBool(env: NodeJS.ProcessEnv, key: string): boolean {
  const raw = String(env[key] ?? "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function readCanaryPct(env: NodeJS.ProcessEnv): number {
  const pctRaw = Number(String(env.PRICING_ENGINE_CANARY_PCT ?? "0").trim());
  if (!Number.isFinite(pctRaw)) return 0;
  return Math.max(0, Math.min(100, Math.floor(pctRaw)));
}

/**
 * Resolve flags from environment. Phase 0 production: leave unset → all off.
 */
export function resolvePricingEngineFlags(
  env: NodeJS.ProcessEnv = process.env
): PricingEngineFlags {
  return {
    shadowEnabled: readBool(env, "PRICING_ENGINE_SHADOW"),
    canaryPct: readCanaryPct(env),
    serviceEnabled: {
      ride: readBool(env, "PRICING_ENGINE_SERVICE_RIDE"),
      food: readBool(env, "PRICING_ENGINE_SERVICE_FOOD"),
      package: readBool(env, "PRICING_ENGINE_SERVICE_PACKAGE"),
      marketplace: readBool(env, "PRICING_ENGINE_SERVICE_MARKETPLACE"),
    },
    killSwitch: readBool(env, "PRICING_ENGINE_KILL_SWITCH"),
  };
}

/**
 * Charge path selector.
 * Phase 3: Food/Package may return engine under flags + canary; Ride/Marketplace stay legacy.
 */
export function resolveChargePath(
  flags: PricingEngineFlags,
  service: PricingEngineService,
  options?: { canaryKey?: string | null }
): ChargePath {
  return resolveChargePathForPhase(flags, service, undefined, options);
}
