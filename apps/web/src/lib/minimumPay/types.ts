export const MINIMUM_PAY_MODES = ["off", "shadow", "active"] as const;
export type MinimumPayMode = (typeof MINIMUM_PAY_MODES)[number];

export const MINIMUM_PAY_ROUNDINGS = [
  "ceil_cents",
  "floor_cents",
  "half_up_cents",
] as const;
export type MinimumPayRounding = (typeof MINIMUM_PAY_ROUNDINGS)[number];

export const MINIMUM_PAY_RULE_STATUSES = ["draft", "active", "archived"] as const;
export type MinimumPayRuleStatus = (typeof MINIMUM_PAY_RULE_STATUSES)[number];

export const MINIMUM_PAY_ADJUSTMENT_KINDS = [
  "individual",
  "fleet_allocation",
] as const;
export type MinimumPayAdjustmentKind =
  (typeof MINIMUM_PAY_ADJUSTMENT_KINDS)[number];

export type TimeInterval = {
  startedAtMs: number;
  endedAtMs: number;
};

export type EarningsLineInput = {
  sourceType: string;
  amountCents: number;
  countsTowardMpr: boolean;
};

export type StandardMethodConfig = {
  method: string;
  mprCentsPerHour: number;
  rounding: string;
};

export type StandardDriverInput = {
  driverId: string;
  tripIntervals: TimeInterval[];
  onCallIntervals: TimeInterval[];
  earnings: EarningsLineInput[];
};

export type StandardComputeInput = {
  config: StandardMethodConfig;
  periodStartsAtMs: number;
  periodEndsAtMs: number;
  drivers: StandardDriverInput[];
};

export type StandardDriverResult = {
  driverId: string;
  tripSeconds: number;
  onCallSeconds: number;
  requiredCents: number;
  eligibleCents: number;
  deficitCents: number;
  adjustmentCents: number;
  fleetAllocationCents: number;
  totalAdjustmentCents: number;
  includedEarningsCents: number;
  excludedEarningsCents: number;
};

export type StandardComputeResult = {
  method: string;
  mprCentsPerHour: number;
  rounding: string;
  fleetTripSeconds: number;
  fleetOnCallSeconds: number;
  requiredAggCents: number;
  eligibleAggCents: number;
  fleetDeficitCents: number;
  drivers: StandardDriverResult[];
};

export type MinimumPayEngineSettings = {
  mode: MinimumPayMode;
  engineStartAt: string | null;
  timezone: string | null;
  periodLengthDays: number | null;
  periodStartWeekday: number | null;
  defaultJurisdiction: string | null;
  defaultCurrency: string | null;
  defaultMethod: string | null;
  defaultRounding: string | null;
  eligibleCountyCodes: string[];
  eligibleSourceTypes: string[];
  excludedSourceTypes: string[];
  waitFeeCounts: boolean;
  bonusCounts: boolean;
  transfersEnabled: boolean;
  onCallStaleAfterSeconds: number | null;
  requireChangeReason: boolean;
};

export type PayRuleVersion = {
  id: string;
  jurisdiction: string;
  ruleName: string;
  ruleVersion: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  mprCentsPerHour: number;
  method: string;
  rounding: string;
  eligibleSourceTypes: string[];
  excludedSourceTypes: string[];
  waitFeeCounts: boolean | null;
  bonusCounts: boolean | null;
  notes: string | null;
  status: MinimumPayRuleStatus;
  sourceUrl: string | null;
  sourceLabel: string | null;
};
