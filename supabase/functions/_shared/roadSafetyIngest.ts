// Shared server-side ingestion routine (Deno). Fetches OpenStreetMap data from
// Overpass with retry/backoff, maps to normalized events and upserts them with
// a TTL. Reused by the manual (`road-safety-ingest-osm`) and scheduled
// (`road-safety-ingest-scheduled`) Edge Functions so the logic lives once.
//
// OSM data is ODbL — attribution "© OpenStreetMap contributors" is required by
// any client displaying it.
import { buildOverpassQuery, mapOsmElements, type OsmElement } from "./osmSafetyMapping.ts";
import {
  OVERPASS_MAX_ATTEMPTS,
  OVERPASS_TIMEOUT_MS,
  isRetryableOverpassStatus,
  overpassBackoffMs,
  overpassEndpointForAttempt,
  parseOverpassResponse,
} from "./overpassClient.ts";

export type IngestBbox = { south: number; west: number; north: number; east: number };

export type IngestResult = {
  fetched: number;
  mapped: number;
  upserted: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fetch Overpass for a bbox with retry + exponential backoff across mirror
 * endpoints. Respects provider limits by backing off on 429/504.
 */
async function fetchOverpass(
  bbox: IngestBbox,
  maxAttempts = OVERPASS_MAX_ATTEMPTS,
): Promise<OsmElement[]> {
  const query = buildOverpassQuery(bbox);
  let lastError = "unknown";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const endpoint = overpassEndpointForAttempt(attempt);
    try {
      // Per-request timeout so a single slow/hung mirror cannot consume the
      // whole Edge Function wall-clock budget (150s).
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain", "User-Agent": "MMD-Delivery/road-safety" },
        body: query,
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
      });
      const host = new URL(endpoint).host;
      const tag = `${host}:attempt${attempt + 1}/${maxAttempts}`;
      console.error(`[overpass] ${tag} HTTP ${res.status}`);
      if (isRetryableOverpassStatus(res.status)) {
        lastError = `rate_limited_${res.status}:${tag}`;
        if (attempt < maxAttempts - 1) await sleep(overpassBackoffMs(attempt));
        continue;
      }
      if (!res.ok) {
        lastError = `overpass_${res.status}:${tag}`;
        throw new Error(`overpass_failed:${lastError}`);
      }
      const jsonBody = await res.json().catch(() => null);
      const parsed = parseOverpassResponse(jsonBody);
      if (parsed.ok) return parsed.elements;
      lastError = `${parsed.error}:${tag}`;
      if (!parsed.retryable) {
        throw new Error(`overpass_failed:${lastError}`);
      }
      if (attempt < maxAttempts - 1) await sleep(overpassBackoffMs(attempt));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith("overpass_failed:")) throw error;
      lastError = `${message}:${new URL(endpoint).host}:attempt${attempt + 1}/${maxAttempts}`;
      if (attempt < maxAttempts - 1) await sleep(overpassBackoffMs(attempt));
    }
  }
  throw new Error(`overpass_failed:${lastError}`);
}

type AdminClient = {
  from: (table: string) => {
    upsert: (
      rows: unknown[],
      opts: { onConflict: string },
    ) => Promise<{ error: { message: string } | null }>;
  };
};

/** Fetch + map + dedup-upsert road-safety events for one bbox. */
export async function ingestBbox(
  admin: AdminClient,
  params: { bbox: IngestBbox; countryCode: string | null; ttlHours: number },
): Promise<IngestResult> {
  const elements = await fetchOverpass(params.bbox);
  const mapped = mapOsmElements(elements);

  const expiresAt = new Date(Date.now() + params.ttlHours * 3600_000).toISOString();
  const rows = mapped.map((event) => ({
    ...event,
    country_code: params.countryCode,
    is_active: true,
    expires_at: expiresAt,
  }));

  let upserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await admin
      .from("road_safety_events")
      .upsert(chunk, { onConflict: "source,source_ref" });
    if (error) throw new Error(`upsert_failed:${error.message}`);
    upserted += chunk.length;
  }

  return { fetched: elements.length, mapped: mapped.length, upserted };
}
