/** Phase 5F — PE quote snapshot meta */
export const PE_QUOTE_ENGINE_VERSION = "pricing-engine-sot-hot-path@5F";

export type PeChargeMeta = {
  chargePath: "engine";
  engineVersion: string;
  failOpen: false;
  source: "pricing_engine_sot";
};
