/**
 * Overpass HTTP client helpers shared by road-safety ingest.
 * Pure functions (no Deno APIs) so Node tests can cover retry classification
 * and JSON validation without mocking fetch.
 *
 * OSM data is ODbL — attribution "© OpenStreetMap contributors" is required.
 */
import type { OsmElement } from "./osmSafetyMapping.ts";

export const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
] as const;

export const OVERPASS_MAX_ATTEMPTS = 5;
/** Per-request cap. Five attempts must stay under the 150s Edge wall-clock. */
export const OVERPASS_TIMEOUT_MS = 20_000;

export function overpassEndpointForAttempt(attempt: number): string {
  return OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
}

/** 429 / 5xx / timeout-class statuses are transient; 4xx otherwise is definitive. */
export function isRetryableOverpassStatus(status: number): boolean {
  return (
    status === 403 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

export function overpassBackoffMs(attempt: number): number {
  const exp = Math.min(2000 * Math.pow(2, attempt), 16_000);
  return exp;
}

export type OverpassParseResult =
  | { ok: true; elements: OsmElement[] }
  | { ok: false; error: string; retryable: boolean };

/**
 * Validate an Overpass JSON body. An empty `elements` array is valid (bbox
 * with no matching features). Missing/non-array `elements` is a definitive
 * failure. Timeout/rate remarks are retryable.
 */
export function parseOverpassResponse(body: unknown): OverpassParseResult {
  if (body == null || typeof body !== "object") {
    return { ok: false, error: "invalid_json", retryable: true };
  }
  const rec = body as Record<string, unknown>;
  const remark = typeof rec.remark === "string" ? rec.remark : "";
  if (remark && /error|timeout|rate.?limit|too many/i.test(remark)) {
    return { ok: false, error: `overpass_remark`, retryable: true };
  }
  if (!Array.isArray(rec.elements)) {
    return { ok: false, error: "missing_elements", retryable: false };
  }
  return { ok: true, elements: rec.elements as OsmElement[] };
}
