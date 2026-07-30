/** Shared financial status → color for wallet/history UIs. */
export type FinancialStatusTone =
  | "success"
  | "pending"
  | "failed"
  | "neutral"
  | "refunded";

const SUCCESS = new Set([
  "paid",
  "completed",
  "success",
  "posted",
  "succeeded",
  "refunded",
  "transferred",
]);
const FAILED = new Set([
  "failed",
  "canceled",
  "cancelled",
  "refund_failed",
  "disputed",
  "error",
]);
const PENDING = new Set([
  "pending",
  "approved",
  "processing",
  "in_transit",
  "queued",
  "full_refund_required",
]);

export function financialStatusTone(status: string | null | undefined): FinancialStatusTone {
  const s = String(status ?? "").trim().toLowerCase();
  if (s === "refunded" || s === "partially_refunded") return "refunded";
  if (SUCCESS.has(s)) return "success";
  if (FAILED.has(s)) return "failed";
  if (PENDING.has(s)) return "pending";
  return "neutral";
}

export function financialStatusColor(status: string | null | undefined): string {
  switch (financialStatusTone(status)) {
    case "success":
    case "refunded":
      return "#22C55E";
    case "failed":
      return "#FCA5A5";
    case "pending":
      return "#F59E0B";
    default:
      return "#94A3B8";
  }
}
