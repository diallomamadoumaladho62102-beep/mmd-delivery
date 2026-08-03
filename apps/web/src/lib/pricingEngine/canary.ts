/**
 * Deterministic canary bucket (Phase 3).
 * Same canaryKey always maps to the same 0–99 bucket.
 */
import { createHash } from "node:crypto";

export function canaryBucket(canaryKey: string): number {
  const digest = createHash("sha256")
    .update(String(canaryKey || ""))
    .digest();
  // First 4 bytes → uint32 → 0..99
  const n = digest.readUInt32BE(0);
  return n % 100;
}

/**
 * Returns true when the key falls in the canary percentage [0, canaryPct).
 * canaryPct 0 → never; 100 → always (caller may short-circuit).
 */
export function isInCanaryBucket(
  canaryKey: string,
  canaryPct: number
): boolean {
  const pct = Math.max(0, Math.min(100, Math.floor(canaryPct)));
  if (pct <= 0) return false;
  if (pct >= 100) return true;
  return canaryBucket(canaryKey) < pct;
}
