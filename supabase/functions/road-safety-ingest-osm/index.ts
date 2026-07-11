// deno-lint-ignore-file no-explicit-any
// OpenStreetMap (Overpass) ingestion for road-safety events.
//
// Runs SERVER-SIDE only. Overpass requires no API key, but is rate-limited, so
// results are cached/upserted into `road_safety_events` with an expiry. Callers
// must present the shared ingest secret (x-ingest-secret) — never exposed to
// the mobile app.
//
// Input (POST JSON): { bbox: {south,west,north,east}, countryCode?: string, ttlHours?: number }
// OSM data is ODbL — attribution "© OpenStreetMap contributors" is required by
// any client displaying it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";
import {
  buildOverpassQuery,
  mapOsmElements,
  type OsmElement,
} from "../_shared/osmSafetyMapping.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-ingest-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const ingestSecret = Deno.env.get("ROAD_SAFETY_INGEST_SECRET");
  const provided = req.headers.get("x-ingest-secret");
  if (!ingestSecret || provided !== ingestSecret) {
    return json({ error: "unauthorized" }, 401);
  }

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ error: "server_misconfigured" }, 500);

    const body = (await req.json().catch(() => ({}))) as {
      bbox?: { south: number; west: number; north: number; east: number };
      countryCode?: string;
      ttlHours?: number;
    };
    const bbox = body.bbox;
    if (
      !bbox ||
      ![bbox.south, bbox.west, bbox.north, bbox.east].every((v) => Number.isFinite(v)) ||
      bbox.north - bbox.south > 1 ||
      bbox.east - bbox.west > 1
    ) {
      return json({ error: "invalid_bbox" }, 400);
    }

    const countryCode = String(body.countryCode ?? "").trim().toUpperCase() || null;
    const ttlHours = Math.min(Math.max(Number(body.ttlHours) || 168, 1), 720);

    const overpassRes = await fetch(OVERPASS_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: buildOverpassQuery(bbox),
    });
    if (!overpassRes.ok) {
      return json({ error: "overpass_failed", status: overpassRes.status }, 502);
    }
    const overpassJson = (await overpassRes.json()) as { elements?: OsmElement[] };
    const mapped = mapOsmElements(overpassJson.elements ?? []);

    const expiresAt = new Date(Date.now() + ttlHours * 3600_000).toISOString();
    const rows = mapped.map((event) => ({
      ...event,
      country_code: countryCode,
      is_active: true,
      expires_at: expiresAt,
    }));

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });

    let upserted = 0;
    // Upsert in chunks, de-duplicated by (source, source_ref).
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await admin
        .from("road_safety_events")
        .upsert(chunk, { onConflict: "source,source_ref" });
      if (error) return json({ error: "upsert_failed", details: error.message }, 500);
      upserted += chunk.length;
    }

    return json({
      ok: true,
      fetched: overpassJson.elements?.length ?? 0,
      mapped: mapped.length,
      upserted,
      attribution: "© OpenStreetMap contributors",
    });
  } catch (error) {
    return json(
      { error: "unexpected", details: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
