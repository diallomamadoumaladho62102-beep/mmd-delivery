export type PricingEngineService =
  | "ride"
  | "food"
  | "package"
  | "marketplace";

export type PricingEngineFlags = {
  /** Parallel compute + compare only; charge path remains legacy. */
  shadowEnabled: boolean;
  /** 0–100; Phase 0 must remain 0 in production. */
  canaryPct: number;
  /** Per-service cutover; Phase 0 all false. */
  serviceEnabled: Record<PricingEngineService, boolean>;
  /** When true, force legacy regardless of other flags. */
  killSwitch: boolean;
};

export type ChargePath = "legacy" | "engine";
