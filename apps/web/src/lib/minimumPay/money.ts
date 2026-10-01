import { MINIMUM_PAY_ROUNDINGS } from "./types";

export function applyConfiguredRounding(
  mprCentsPerHour: number,
  seconds: number,
  rounding: string
): number {
  const hoursNumerator = BigInt(Math.max(0, Math.trunc(mprCentsPerHour))) *
    BigInt(Math.max(0, Math.trunc(seconds)));
  const hourSeconds = BigInt(3600);

  if (rounding === "floor_cents") {
    return Number(hoursNumerator / hourSeconds);
  }
  if (rounding === "half_up_cents") {
    return Number((hoursNumerator + BigInt(1800)) / hourSeconds);
  }
  if (rounding === "ceil_cents") {
    return Number((hoursNumerator + hourSeconds - BigInt(1)) / hourSeconds);
  }
  throw new Error("minimum_pay_unknown_rounding");
}

export function isKnownRounding(value: string): boolean {
  return (MINIMUM_PAY_ROUNDINGS as readonly string[]).includes(value);
}

export function floorSpread(
  totalCents: number,
  weights: Array<{ id: string; weight: number }>
): Record<string, number> {
  const out: Record<string, number> = {};
  const safeTotal = Math.max(0, Math.trunc(totalCents));
  const positive = weights
    .map((row) => ({ id: row.id, weight: Math.max(0, row.weight) }))
    .filter((row) => row.weight > 0)
    .sort((a, b) => a.id.localeCompare(b.id));

  const weightSum = positive.reduce((sum, row) => sum + row.weight, 0);
  if (safeTotal === 0 || weightSum <= 0 || positive.length === 0) {
    for (const row of weights) out[row.id] = 0;
    return out;
  }

  let allocated = 0;
  const remainders: Array<{ id: string; fraction: number }> = [];
  for (const row of positive) {
    const raw = (safeTotal * row.weight) / weightSum;
    const whole = Math.floor(raw);
    out[row.id] = whole;
    allocated += whole;
    remainders.push({ id: row.id, fraction: raw - whole });
  }
  remainders.sort((a, b) => b.fraction - a.fraction || a.id.localeCompare(b.id));
  let leftover = safeTotal - allocated;
  for (const row of remainders) {
    if (leftover <= 0) break;
    out[row.id] = (out[row.id] ?? 0) + 1;
    leftover -= 1;
  }
  for (const row of weights) {
    if (out[row.id] == null) out[row.id] = 0;
  }
  return out;
}
