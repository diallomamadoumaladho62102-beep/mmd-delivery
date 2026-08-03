/**
 * Phase 4(+5B) — select Ride charge path with fail-open to legacy.
 * Engine path uses Phase 5B independent PE adapters; defaults remain legacy.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  resolveChargePath,
  resolvePricingEngineFlags,
} from "../flags";
import type { ChargePath, PricingEngineFlags } from "../flagTypes";
import {
  buildRideComparablePair,
  type TaxiQuoteCapture,
} from "../engine/adapters/rideAdapter";
import { compareComparableQuotes } from "../shadow/compareQuotes";
import type { ComparableQuote } from "../shadow/comparableQuote";
import {
  buildFoodPackageQuoteSnapshot,
  persistQuoteSnapshot,
  rememberQuoteSnapshot,
  type FoodPackageQuoteSnapshotRecord,
} from "../snapshot/foodPackageSnapshot";
import { recordCutoverSelection } from "../cutoverMetrics";

export type RideChargeSelection = {
  chargePath: ChargePath;
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
 * Resolve charge for Ride after legacy pricing is computed.
 * Engine requires 0¢ parity vs legacy adapter pair; otherwise fail-open.
 */
export async function selectRideChargePath(input: {
  capture: TaxiQuoteCapture;
  countryCode?: string;
  canaryKey: string;
  supabaseAdmin?: SupabaseClient | null;
  flags?: PricingEngineFlags;
  persistSnapshot?: boolean;
}): Promise<RideChargeSelection> {
  const flags = flagsOrDefault(input.flags);
  const desired = resolveChargePath(flags, "ride", {
    canaryKey: input.canaryKey,
  });

  if (desired === "legacy") {
    recordCutoverSelection({ service: "ride", path: "legacy" });
    return {
      chargePath: "legacy",
      customerTotalCents: Math.round(input.capture.total_cents),
      engineQuote: null,
      snapshot: null,
      failOpen: false,
      reason: "legacy_selected",
    };
  }

  try {
    const pair = buildRideComparablePair(input.capture);
    const report = compareComparableQuotes({
      legacy: pair.legacy,
      engine: pair.engine,
      legacyLatencyMs: 0,
      engineLatencyMs: 0,
      compareId: "ride-cutover-gate",
    });
    if (!report.equal || report.diffCents !== 0) {
      recordCutoverSelection({ service: "ride", path: "fail_open_legacy" });
      console.warn(
        "[pricingEngine.cutover] ride_parity_fail_open",
        JSON.stringify(report.fieldDiffs)
      );
      return {
        chargePath: "legacy",
        customerTotalCents: Math.round(input.capture.total_cents),
        engineQuote: null,
        snapshot: null,
        failOpen: true,
        reason: "parity_mismatch",
      };
    }

    const snapshot = buildFoodPackageQuoteSnapshot({
      service: "ride",
      chargePath: "engine",
      countryCode: input.countryCode ?? "US",
      quote: pair.engine,
      canaryKey: input.canaryKey,
    });
    await commitSnapshot({
      snapshot,
      supabaseAdmin: input.supabaseAdmin,
      persistSnapshot: input.persistSnapshot,
    });

    recordCutoverSelection({ service: "ride", path: "engine" });
    return {
      chargePath: "engine",
      customerTotalCents: pair.engine.customerTotalCents,
      engineQuote: pair.engine,
      snapshot,
      failOpen: false,
      reason: "engine_selected",
    };
  } catch (err) {
    recordCutoverSelection({ service: "ride", path: "fail_open_legacy" });
    console.warn(
      "[pricingEngine.cutover] ride_engine_error_fail_open",
      err instanceof Error ? err.message : err
    );
    return {
      chargePath: "legacy",
      customerTotalCents: Math.round(input.capture.total_cents),
      engineQuote: null,
      snapshot: null,
      failOpen: true,
      reason: "engine_error",
    };
  }
}
