/**
 * In-process metrics for Phase 2 shadow (no Stripe, no charge impact).
 */

export type ShadowMetricsSnapshot = {
  compared: number;
  equal: number;
  diff: number;
  errors: number;
  parityPct: number;
  legacyLatencySumMs: number;
  engineLatencySumMs: number;
  legacyLatencyMaxMs: number;
  engineLatencyMaxMs: number;
  dbWrites: number;
  stripeCalls: number;
};

export type ShadowMetricsReport = ShadowMetricsSnapshot & {
  legacyLatencyAvgMs: number;
  engineLatencyAvgMs: number;
  stripeCallsInShadow: number;
};

const state: ShadowMetricsSnapshot = {
  compared: 0,
  equal: 0,
  diff: 0,
  errors: 0,
  parityPct: 100,
  legacyLatencySumMs: 0,
  engineLatencySumMs: 0,
  legacyLatencyMaxMs: 0,
  engineLatencyMaxMs: 0,
  dbWrites: 0,
  stripeCalls: 0,
};

export function recordShadowMetrics(input: {
  equal: boolean;
  legacyLatencyMs: number;
  engineLatencyMs: number;
  error?: boolean;
  dbWrite?: boolean;
}): void {
  if (input.error) {
    state.errors += 1;
    return;
  }
  state.compared += 1;
  if (input.equal) state.equal += 1;
  else state.diff += 1;
  state.parityPct =
    state.compared === 0
      ? 100
      : Math.round((state.equal / state.compared) * 10000) / 100;
  state.legacyLatencySumMs += input.legacyLatencyMs;
  state.engineLatencySumMs += input.engineLatencyMs;
  state.legacyLatencyMaxMs = Math.max(
    state.legacyLatencyMaxMs,
    input.legacyLatencyMs
  );
  state.engineLatencyMaxMs = Math.max(
    state.engineLatencyMaxMs,
    input.engineLatencyMs
  );
  if (input.dbWrite) state.dbWrites += 1;
}

export function getShadowMetricsSnapshot(): ShadowMetricsSnapshot {
  return { ...state };
}

export function formatShadowMetricsReport(): ShadowMetricsReport {
  const snap = getShadowMetricsSnapshot();
  return {
    ...snap,
    legacyLatencyAvgMs: averageLatencyMs(
      snap.legacyLatencySumMs,
      snap.compared
    ),
    engineLatencyAvgMs: averageLatencyMs(
      snap.engineLatencySumMs,
      snap.compared
    ),
    stripeCallsInShadow: snap.stripeCalls,
  };
}

export function resetShadowMetricsForTests(): void {
  state.compared = 0;
  state.equal = 0;
  state.diff = 0;
  state.errors = 0;
  state.parityPct = 100;
  state.legacyLatencySumMs = 0;
  state.engineLatencySumMs = 0;
  state.legacyLatencyMaxMs = 0;
  state.engineLatencyMaxMs = 0;
  state.dbWrites = 0;
  state.stripeCalls = 0;
}

export function averageLatencyMs(sum: number, count: number): number {
  if (count <= 0) return 0;
  return Math.round((sum / count) * 100) / 100;
}
