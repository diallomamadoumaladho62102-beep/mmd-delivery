// Shared server-side ingestion routine (Deno). Fetches OpenStreetMap data from
// Overpass with retry/backoff, maps to normalized events and upserts them with
// a TTL. Reused by the manual (`road-safety-ingest-osm`) and scheduled
// (`road-safety-ingest-scheduled`) Edge Functions so the logic lives once.
//
// OSM data is ODbL — attribution "© OpenStreetMap contributors" is required by
// any client displaying it.
import { buildOverpassQuery, mapOsmElements, type OsmElement } from "./osmSafetyMapping.ts";

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

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
async function fetchOverpass(bbox: IngestBbox, maxAttempts = 3): Promise<OsmElement[]> {
  const query = buildOverpassQuery(bbox);
  let lastError = "unknown";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const endpoint = OVERPASS_ENDPOINTS[attempt % OVERPASS_ENDPOINTS.length];
    try {
      // Per-request timeout so a single slow/hung mirror cannot consume the
      // whole Edge Function wall-clock budget (150s).
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "text/plain", "User-Agent": "MMD-Delivery/road-safety" },
        body: query,
        signal: AbortSignal.timeout(30000),
      });
      if (res.status === 429 || res.status === 504 || res.status === 502) {
        lastError = `rate_limited_${res.status}`;
        await sleep(1500 * Math.pow(2, attempt));
        continue;
      }
      if (!res.ok) {
        lastError = `overpass_${res.status}`;
        await sleep(800 * Math.pow(2, attempt));
        continue;
      }
      const jsonBody = (await res.json()) as { elements?: OsmElement[] };
      return jsonBody.elements ?? [];
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(800 * Math.pow(2, attempt));
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
