/** Safe wallet/payout field rendering — never show `[object Object]`. */

export function formatWalletField(value: unknown, fallback = "—"): string {
  if (value == null) return fallback;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "[object Object]") return fallback;
    return trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  return fallback;
}

export function payoutStatusKey(status: unknown): string {
  return formatWalletField(status, "unknown").toLowerCase();
}

export function isProcessingPayoutStatus(status: unknown): boolean {
  return ["pending", "processing", "in_transit", "queued", "approved"].includes(
    payoutStatusKey(status),
  );
}

export function isPaidPayoutStatus(status: unknown): boolean {
  return ["paid", "completed", "success"].includes(payoutStatusKey(status));
}

export function isFailedPayoutStatus(status: unknown): boolean {
  return ["failed", "canceled", "cancelled", "reversed"].includes(
    payoutStatusKey(status),
  );
}

export function payoutStatusLabel(status: unknown): string {
  const key = payoutStatusKey(status);
  if (isPaidPayoutStatus(key)) return "driver.wallet.payouts.status.paid";
  if (isFailedPayoutStatus(key) && (key === "canceled" || key === "cancelled")) {
    return "driver.wallet.payouts.status.canceled";
  }
  if (key === "reversed") return "driver.wallet.payouts.status.reversed";
  if (isFailedPayoutStatus(key)) return "driver.wallet.payouts.status.failed";
  if (isProcessingPayoutStatus(key)) return "driver.wallet.payouts.status.processing";
  return "driver.wallet.payouts.status.unknown";
}
