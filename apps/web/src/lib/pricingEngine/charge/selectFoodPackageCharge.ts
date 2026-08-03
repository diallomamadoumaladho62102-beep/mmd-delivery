/**
 * Phase 3(+5B) — select Food/Package charge path with fail-open to legacy.
 * Engine path uses Phase 5B independent PE adapters; defaults remain legacy.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveChargePath,
  resolvePricingEngineFlags,
} from "../flags";
import type { ChargePath, PricingEngineFlags } from "../flagTypes";
import { buildFoodComparablePair } from "../engine/adapters/foodAdapter";
import { buildPackageComparablePair } from "../engine/adapters/packageAdapter";
import { compareComparableQuotes } from "../shadow/compareQuotes";
import type { ComparableQuote } from "../shadow/comparableQuote";
import {
  buildFoodPackageQuoteSnapshot,
  persistQuoteSnapshot,
  rememberQuoteSnapshot,
  type FoodPackageQuoteSnapshotRecord,
} from "../snapshot/foodPackageSnapshot";
import { recordCutoverSelection } from "../cutoverMetrics";
import type { FoodOrderPricingResult } from "@/lib/foodOrderServerPricing";
import type { DeliveryQuoteCapture } from "../engine/adapters/packageAdapter";

export type FoodPackageChargeSelection = {
  chargePath: ChargePath;
  /** Amount used for response / PaymentIntent (always from selected path). */
  customerTotalCents: number;
  engineQuote: ComparableQuote | null;
  snapshot: FoodPackageQuoteSnapshotRecord | null;
  failOpen: boolean;
  reason: string;
};

function flagsOrDefault(flags?: PricingEngineFlags): PricingEngineFlags {
  return flags ?? resolvePricingEngineFlags();
}

async function commitSnapshot(input: {
  snapshot: FoodPackageQuoteSnapshotRecord;
  supabaseAdmin?: SupabaseClient | null;
  persistSnapshot?: boolean;
}): Promise<void> {
  if (input.persistSnapshot === false) {
    rememberQuoteSnapshot(input.snapshot);
    return;
  }
  await persistQuoteSnapshot({
    record: input.snapshot,
    supabaseAdmin: input.supabaseAdmin,
  });
}


/**
 * Resolve charge for Food after legacy pricing is computed.
 * Engine requires 0¢ parity vs legacy adapter pair; otherwise fail-open.
 */
export async function selectFoodChargePath(input: {
  pricing: FoodOrderPricingResult;
  canaryKey: string;
  supabaseAdmin?: SupabaseClient | null;
  flags?: PricingEngineFlags;
  persistSnapshot?: boolean;
}): Promise<FoodPackageChargeSelection> {
  const flags = flagsOrDefault(input.flags);
  const desired = resolveChargePath(flags, "food", {
    canaryKey: input.canaryKey,
  });

  if (desired === "legacy") {
    recordCutoverSelection({ service: "food", path: "legacy" });
    return {
      chargePath: "legacy",
      customerTotalCents: input.pricing.totalCents,
      engineQuote: null,
      snapshot: null,
      failOpen: false,
      reason: "legacy_selected",
    };
  }

  try {
    const pair = buildFoodComparablePair(input.pricing);
    const report = compareComparableQuotes({
      legacy: pair.legacy,
      engine: pair.engine,
      legacyLatencyMs: 0,
      engineLatencyMs: 0,
      compareId: "food-cutover-gate",
    });
    if (!report.equal || report.diffCents !== 0) {
      recordCutoverSelection({ service: "food", path: "fail_open_legacy" });
      console.warn(
        "[pricingEngine.cutover] food_parity_fail_open",
        JSON.stringify(report.fieldDiffs)
      );
      return {
        chargePath: "legacy",
        customerTotalCents: input.pricing.totalCents,
        engineQuote: null,
        snapshot: null,
        failOpen: true,
        reason: "parity_mismatch",
      };
    }

    const snapshot = buildFoodPackageQuoteSnapshot({
      service: "food",
      chargePath: "engine",
      countryCode: input.pricing.countryCode,
      quote: pair.engine,
      canaryKey: input.canaryKey,
    });
    await commitSnapshot({
      snapshot,
      supabaseAdmin: input.supabaseAdmin,
      persistSnapshot: input.persistSnapshot,
    });

    recordCutoverSelection({ service: "food", path: "engine" });
    return {
      chargePath: "engine",
      customerTotalCents: pair.engine.customerTotalCents,
      engineQuote: pair.engine,
      snapshot,
      failOpen: false,
      reason: "engine_selected",
    };
  } catch (err) {
    recordCutoverSelection({ service: "food", path: "fail_open_legacy" });
    console.warn(
      "[pricingEngine.cutover] food_engine_error_fail_open",
      err instanceof Error ? err.message : err
    );
    return {
      chargePath: "legacy",
      customerTotalCents: input.pricing.totalCents,
      engineQuote: null,
      snapshot: null,
      failOpen: true,
      reason: "engine_error",
    };
  }
}

/**
 * Resolve charge for Package after legacy pricing is computed.
 */
export async function selectPackageChargePath(input: {
  pricing: DeliveryQuoteCapture & { countryCode?: string };
  canaryKey: string;
  supabaseAdmin?: SupabaseClient | null;
  flags?: PricingEngineFlags;
  persistSnapshot?: boolean;
}): Promise<FoodPackageChargeSelection> {
  const flags = flagsOrDefault(input.flags);
  const desired = resolveChargePath(flags, "package", {
    canaryKey: input.canaryKey,
  });

  if (desired === "legacy") {
    recordCutoverSelection({ service: "package", path: "legacy" });
    return {
      chargePath: "legacy",
      customerTotalCents: input.pricing.totalCents,
      engineQuote: null,
      snapshot: null,
      failOpen: false,
      reason: "legacy_selected",
    };
  }

  try {
    const pair = buildPackageComparablePair(input.pricing);
    const report = compareComparableQuotes({
      legacy: pair.legacy,
      engine: pair.engine,
      legacyLatencyMs: 0,
      engineLatencyMs: 0,
      compareId: "package-cutover-gate",
    });
    if (!report.equal || report.diffCents !== 0) {
      recordCutoverSelection({ service: "package", path: "fail_open_legacy" });
      console.warn(
        "[pricingEngine.cutover] package_parity_fail_open",
        JSON.stringify(report.fieldDiffs)
      );
      return {
        chargePath: "legacy",
        customerTotalCents: input.pricing.totalCents,
        engineQuote: null,
        snapshot: null,
        failOpen: true,
        reason: "parity_mismatch",
      };
    }

    const snapshot = buildFoodPackageQuoteSnapshot({
      service: "package",
      chargePath: "engine",
      countryCode: input.pricing.countryCode ?? "US",
      quote: pair.engine,
      canaryKey: input.canaryKey,
    });
    await commitSnapshot({
      snapshot,
      supabaseAdmin: input.supabaseAdmin,
      persistSnapshot: input.persistSnapshot,
    });

    recordCutoverSelection({ service: "package", path: "engine" });
    return {
      chargePath: "engine",
      customerTotalCents: pair.engine.customerTotalCents,
      engineQuote: pair.engine,
      snapshot,
      failOpen: false,
      reason: "engine_selected",
    };
  } catch (err) {
    recordCutoverSelection({ service: "package", path: "fail_open_legacy" });
    console.warn(
      "[pricingEngine.cutover] package_engine_error_fail_open",
      err instanceof Error ? err.message : err
    );
    return {
      chargePath: "legacy",
      customerTotalCents: input.pricing.totalCents,
      engineQuote: null,
      snapshot: null,
      failOpen: true,
      reason: "engine_error",
    };
  }
}
