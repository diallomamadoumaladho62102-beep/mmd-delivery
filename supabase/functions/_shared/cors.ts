/**
 * Restrict browser CORS for Edge Functions to known MMD web origins.
 * Native mobile clients do not rely on CORS.
 */

const DEFAULT_ALLOWED_ORIGINS = [
  "https://www.mmddelivery.com",
  "https://mmddelivery.com",
];

function allowedOrigins(): string[] {
  const fromEnv = String(Deno.env.get("MMD_EDGE_CORS_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return fromEnv.length > 0 ? fromEnv : DEFAULT_ALLOWED_ORIGINS;
}

export function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowList = allowedOrigins();
  const allowOrigin = allowList.includes(origin) ? origin : allowList[0];

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    Vary: "Origin",
    "Access-Control-Allow-Headers":
      "authorization, Authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

/** Webhooks should not advertise permissive CORS. */
export function webhookHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  };
}
