import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isKillSwitchActive,
  isShadowCompareAllowed,
} from "../killSwitch";
import {
  resolvePricingEngineFlags,
  type PricingEngineFlags,
} from "../flags";
import { PRICING_ENGINE_MIGRATION_PHASE } from "../phaseGate";
import { compareComparableQuotes } from "./compareQuotes";
import type { ComparableQuote } from "./comparableQuote";
import type { ShadowCompareReport } from "./comparableQuote";
import { recordShadowMetrics } from "./metrics";
import { appendShadowJournal } from "./journal";
import { noopPricingLogger } from "../observability/types";

export type ShadowRunnerDeps = {
  supabaseAdmin?: SupabaseClient | null;
  persist?: boolean;
  samplePct?: number;
  /** Test/harness only — never used by production charge routes. */
  flagsOverride?: PricingEngineFlags;
};

function sampleAllows(samplePct: number): boolean {
  if (samplePct >= 100) return true;
  if (samplePct <= 0) return false;
  return Math.random() * 100 < samplePct;
}

/**
 * Run shadow compare. Never throws to callers. Never affects charge path.
 */
export async function runPricingShadowCompare(input: {
  buildPair: () => { legacy: ComparableQuote; engine: ComparableQuote };
  legacyLatencyMs: number;
  deps?: ShadowRunnerDeps;
}): Promise<ShadowCompareReport | null> {
  const flags =
    input.deps?.flagsOverride ?? resolvePricingEngineFlags();
  if (PRICING_ENGINE_MIGRATION_PHASE < 2) return null;
  if (isKillSwitchActive(flags)) return null;
  if (!isShadowCompareAllowed(flags)) return null;

  const samplePct = Number(
    input.deps?.samplePct ??
      process.env.PRICING_ENGINE_SHADOW_SAMPLE_PCT ??
      100
  );
  if (!sampleAllows(Number.isFinite(samplePct) ? samplePct : 100)) {
    return null;
  }

  const t0 = Date.now();
  try {
    const pair = input.buildPair();
    const engineLatencyMs = Math.max(0, Date.now() - t0);
    const report = compareComparableQuotes({
      legacy: pair.legacy,
      engine: pair.engine,
      legacyLatencyMs: input.legacyLatencyMs,
      engineLatencyMs,
      compareId: randomUUID(),
    });

    noopPricingLogger.logDecision({
      at: report.at,
      service: report.service,
      decision: "shadow_compare",
      details: {
        equal: report.equal,
        diffCents: report.diffCents,
        fieldDiffs: report.fieldDiffs,
        compareId: report.compareId,
        legacyLatencyMs: report.legacyLatencyMs,
        engineLatencyMs: report.engineLatencyMs,
      },
    });

    appendShadowJournal(report);

    let dbWrite = false;
    if (input.deps?.persist !== false && input.deps?.supabaseAdmin) {
      try {
        const { error } = await input.deps.supabaseAdmin
          .from("pricing_shadow_compare_logs")
          .insert({
            compare_id: report.compareId,
            service: report.service,
            currency: report.currency,
            equal: report.equal,
            diff_cents: report.diffCents,
            legacy_total_cents: report.legacy.customerTotalCents,
            engine_total_cents: report.engine.customerTotalCents,
            field_diffs: report.fieldDiffs,
            legacy_latency_ms: report.legacyLatencyMs,
            engine_latency_ms: report.engineLatencyMs,
            legacy_version: report.legacy.legacyVersion,
            engine_version: report.engine.engineVersion,
            legacy_payload: report.legacy,
            engine_payload: report.engine,
          });
        if (!error) dbWrite = true;
      } catch {
        // ignore persist errors — never affect production quote
      }
    }

    recordShadowMetrics({
      equal: report.equal,
      legacyLatencyMs: report.legacyLatencyMs,
      engineLatencyMs: report.engineLatencyMs,
      dbWrite,
    });

    if (!report.equal) {
      console.warn(
        "[pricingEngine.shadow] parity_diff",
        JSON.stringify({
          compareId: report.compareId,
          service: report.service,
          diffCents: report.diffCents,
          fieldDiffs: report.fieldDiffs,
        })
      );
    }

    return report;
  } catch (err) {
    recordShadowMetrics({
      equal: false,
      legacyLatencyMs: input.legacyLatencyMs,
      engineLatencyMs: Math.max(0, Date.now() - t0),
      error: true,
    });
    console.warn(
      "[pricingEngine.shadow] error",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

/**
 * Fire-and-forget shadow (does not block the HTTP response).
 */
export function schedulePricingShadowCompare(input: {
  buildPair: () => { legacy: ComparableQuote; engine: ComparableQuote };
  legacyLatencyMs: number;
  deps?: ShadowRunnerDeps;
}): void {
  queueMicrotask(() => {
    void runPricingShadowCompare(input);
  });
}
