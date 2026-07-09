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

/** Cron / monitoring probes only — no public health in production. */
export function isInternalHealthAuthorized(req: NextRequest | Request): boolean {
  if (!isProductionRuntime()) return true;

  const cronSecret = String(process.env.CRON_SECRET ?? "").trim();
  const monitoringSecret = String(process.env.MONITORING_SECRET ?? "").trim();
  const expected = monitoringSecret || cronSecret;

  if (!expected) return false;

  const headerSecret = String(req.headers.get("x-cron-secret") ?? "").trim();
  if (headerSecret && timingSafeEqual(headerSecret, expected)) return true;

  const monitoringHeader = String(req.headers.get("x-monitoring-secret") ?? "").trim();
  if (monitoringHeader && monitoringSecret && timingSafeEqual(monitoringHeader, monitoringSecret)) {
    return true;
  }

  const authHeader = String(req.headers.get("authorization") ?? "");
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const bearer = bearerMatch?.[1]?.trim() ?? "";
  if (bearer && timingSafeEqual(bearer, expected)) return true;

  return false;
}
