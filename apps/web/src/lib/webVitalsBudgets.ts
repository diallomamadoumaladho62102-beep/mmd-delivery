/**
 * Phase 9 — Web Vitals helpers (CLS/LCP/INP budgets for CI smoke).
 * Runtime reporting can be wired from app/layout via dynamic import.
 */

export const WEB_VITALS_BUDGETS = {
  LCP_MS: 2500,
  INP_MS: 200,
  CLS: 0.1,
  TTFB_MS: 800,
} as const;

export type VitalName = "LCP" | "INP" | "CLS" | "TTFB" | "FCP";

export function isWithinBudget(
  name: VitalName,
  value: number
): { ok: boolean; budget: number; value: number } {
  const budget =
    name === "LCP"
      ? WEB_VITALS_BUDGETS.LCP_MS
      : name === "INP"
        ? WEB_VITALS_BUDGETS.INP_MS
        : name === "CLS"
          ? WEB_VITALS_BUDGETS.CLS
          : name === "TTFB"
            ? WEB_VITALS_BUDGETS.TTFB_MS
            : WEB_VITALS_BUDGETS.LCP_MS;
  return { ok: value <= budget, budget, value };
}

export function summarizeVitals(
  rows: Array<{ name: VitalName; value: number }>
): { ok: boolean; failures: Array<{ name: VitalName; value: number; budget: number }> } {
  const failures = [];
  for (const row of rows) {
    const check = isWithinBudget(row.name, row.value);
    if (!check.ok) failures.push({ name: row.name, value: row.value, budget: check.budget });
  }
  return { ok: failures.length === 0, failures };
}
