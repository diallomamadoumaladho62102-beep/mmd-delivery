/**
 * Pure helpers for partner SCT clawback (no Stripe / DB imports).
 */

/** Stripe already reversed / idempotent replay — treat as success, not recovery. */
export function isBenignTransferReversalError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    const msg = err instanceof Error ? err.message : String(err ?? "");
    const lower = msg.toLowerCase();
    return (
      lower.includes("already been reversed") ||
      lower.includes("has already been reversed")
    );
  }
  const code = String((err as { code?: unknown }).code ?? "")
    .trim()
    .toLowerCase();
  const msg = String(
    (err as { message?: unknown }).message ??
      (err instanceof Error ? err.message : "")
  ).toLowerCase();
  if (code === "transfer_already_reversed") return true;
  if (msg.includes("already been reversed")) return true;
  if (msg.includes("has already been reversed")) return true;
  return false;
}

export function partnerClawbackIdempotencyKey(params: {
  source: string;
  entityType: string;
  entityId: string;
  transferId: string;
  correlationId: string;
}): string {
  return [
    "partner_rev",
    params.source,
    params.entityType,
    params.entityId,
    params.transferId,
    params.correlationId,
  ].join("_");
}
