import { PRICING_ENGINE_MIGRATION_PHASE } from "./phaseGate";
import { isInCanaryBucket } from "./canary";
import type {
  ChargePath,
  PricingEngineFlags,
  PricingEngineService,
} from "./flagTypes";

export type { ChargePath, PricingEngineFlags, PricingEngineService };

export type ChargePathOptions = {
  /** Stable id (user_id / draft id) for deterministic canary. */
  canaryKey?: string | null;
};

/**
 * Ops-facing kill-switch check (does not by itself select engine).
 */
export function isKillSwitchActive(flags: PricingEngineFlags): boolean {
  return flags.killSwitch === true;
}

/**
 * Whether shadow compare harness may run.
 */
export function isShadowCompareAllowed(flags: PricingEngineFlags): boolean {
  if (flags.killSwitch) return false;
  return flags.shadowEnabled === true;
}

function isServiceAllowedForPhase(
  service: PricingEngineService,
  phase: number
): boolean {
  if (phase >= 5) {
    return (
      service === "food" ||
      service === "package" ||
      service === "ride" ||
      service === "marketplace"
    );
  }
  if (phase >= 4) {
    return service === "food" || service === "package" || service === "ride";
  }
  if (phase >= 3) {
    return service === "food" || service === "package";
  }
  return false;
}

/**
 * Charge path selector.
 *
 * - Phase 0–2: always legacy.
 * - Phase 3: Food & Package.
 * - Phase 4: + Ride.
 * - Phase 5: + Marketplace.
 */
export function resolveChargePathForPhase(
  flags: PricingEngineFlags,
  service: PricingEngineService,
  phase: number = PRICING_ENGINE_MIGRATION_PHASE,
  options?: ChargePathOptions
): ChargePath {
  if (flags.killSwitch) return "legacy";

  // Hard gate: no production charge on engine before Phase 3.
  if (phase < 3) return "legacy";

  if (!isServiceAllowedForPhase(service, phase)) return "legacy";

  if (!flags.serviceEnabled[service]) return "legacy";
  if (flags.canaryPct <= 0) return "legacy";
  if (flags.canaryPct >= 100) return "engine";

  const key = String(options?.canaryKey ?? "").trim();
  // Without a stable key, stay on legacy (safe — no random flip).
  if (!key) return "legacy";

  return isInCanaryBucket(key, flags.canaryPct) ? "engine" : "legacy";
}
