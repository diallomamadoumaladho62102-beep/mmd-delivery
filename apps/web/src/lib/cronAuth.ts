import type { NextRequest } from "next/server";

function timingSafeEqual(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let result = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    result |= aBytes[i] ^ bBytes[i];
  }
  return result === 0;
}

export function isProductionRuntime(): boolean {
  return (
    process.env.VERCEL_ENV === "production" ||
    process.env.NODE_ENV === "production"
  );
}

/**
 * Authorize cron / internal money-adjacent jobs.
 *
 * Production rule: CRON_SECRET is required. The `x-vercel-cron` header alone is
 * NOT sufficient (it can be spoofed outside Vercel's network).
 *
 * Accepted credentials (any one):
 * - Authorization: Bearer <CRON_SECRET>
 * - x-cron-secret: <CRON_SECRET>
 *
 * Outside production, missing CRON_SECRET is allowed for local smoke tests.
 */
export function isAuthorizedCronRequest(req: NextRequest | Request): boolean {
  const expected = String(process.env.CRON_SECRET ?? "").trim();

  if (!expected) {
    return !isProductionRuntime();
  }

  const headerSecret = String(req.headers.get("x-cron-secret") ?? "").trim();
  if (headerSecret && timingSafeEqual(headerSecret, expected)) return true;

  const authHeader = String(req.headers.get("authorization") ?? "");
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const bearer = bearerMatch?.[1]?.trim() ?? "";
  if (bearer && timingSafeEqual(bearer, expected)) return true;

  return false;
}
