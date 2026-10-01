import type { MinimumPayEngineSettings, PayRuleVersion } from "./types";

export function sourceCountsTowardMinimum(input: {
  sourceType: string;
  settings: Pick<
    MinimumPayEngineSettings,
    | "eligibleSourceTypes"
    | "excludedSourceTypes"
    | "waitFeeCounts"
    | "bonusCounts"
  >;
  rule?: Pick<
    PayRuleVersion,
    "eligibleSourceTypes" | "excludedSourceTypes" | "waitFeeCounts" | "bonusCounts"
  > | null;
}): boolean {
  const sourceType = String(input.sourceType ?? "").trim();
  if (!sourceType) return false;
  if (sourceType === "tip" || sourceType === "nyc_mpr_adjustment") return false;

  const excluded = new Set(
    [
      ...(input.rule?.excludedSourceTypes ?? []),
      ...input.settings.excludedSourceTypes,
    ].map((v) => String(v).trim())
  );
  if (excluded.has(sourceType)) return false;

  if (sourceType === "wait_fee") {
    return Boolean(input.rule?.waitFeeCounts ?? input.settings.waitFeeCounts);
  }
  if (sourceType === "marketing_bonus") {
    return Boolean(input.rule?.bonusCounts ?? input.settings.bonusCounts);
  }

  const eligible = new Set(
    [
      ...(input.rule?.eligibleSourceTypes ?? []),
      ...input.settings.eligibleSourceTypes,
    ].map((v) => String(v).trim())
  );
  return eligible.has(sourceType);
}
