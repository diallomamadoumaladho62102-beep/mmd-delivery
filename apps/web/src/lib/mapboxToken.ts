/**
 * Unified Mapbox token resolution.
 *
 * Server routes (quotes, geocode, directions): MAPBOX_ACCESS_TOKEN only.
 * Client maps: NEXT_PUBLIC_MAPBOX_TOKEN only.
 * Legacy NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN is accepted as a temporary alias for
 * the public token so existing Vercel env keeps working, but new deploys
 * should set NEXT_PUBLIC_MAPBOX_TOKEN.
 */

export function getServerMapboxToken(): string {
  const token = String(process.env.MAPBOX_ACCESS_TOKEN ?? "").trim();
  if (!token) {
    throw new Error("MAPBOX_ACCESS_TOKEN missing");
  }
  return token;
}

export function tryGetServerMapboxToken(): string | null {
  try {
    return getServerMapboxToken();
  } catch {
    return null;
  }
}

export function getPublicMapboxToken(): string | null {
  const primary = String(process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "").trim();
  if (primary) return primary;
  // Legacy alias — do not use for server-side paid routing.
  const legacy = String(process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN ?? "").trim();
  return legacy || null;
}

export function assertMapboxEnvConfigured(): {
  ok: boolean;
  server: boolean;
  public: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const server = Boolean(String(process.env.MAPBOX_ACCESS_TOKEN ?? "").trim());
  const pub = Boolean(getPublicMapboxToken());
  if (!server) errors.push("MAPBOX_ACCESS_TOKEN is required for server geocoding/directions");
  if (!pub) errors.push("NEXT_PUBLIC_MAPBOX_TOKEN is required for client maps");
  return { ok: errors.length === 0, server, public: pub, errors };
}
