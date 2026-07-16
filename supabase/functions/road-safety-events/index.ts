// deno-lint-ignore-file no-explicit-any
// Road-safety events query endpoint called by the mobile navigation screen.
//
// Input (POST JSON): { bbox: {south,west,north,east}, countryCode?: string }
// Output: { events: [...], config: {...}, attribution: string }
//
// No provider secret keys are exposed to the client. This function reads the
// aggregated `road_safety_events` table (curated + OSM-ingested) filtered by the
// per-country config, and returns the ODbL attribution string.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";
import { resolveEnabledTypes, validateBbox } from "../_shared/roadSafetyValidation.ts";
import {
  getEdgeSecretKeyOptional,
  getEdgeSupabaseUrl,
} from "../_shared/supabaseKeys.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";


function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" },
  });
}

const ATTRIBUTION = "© OpenStreetMap contributors";

const DEFAULT_CONFIG = {
  enable_speed_camera: false,
  enable_red_light_camera: false,
  enable_stop_sign: true,
  enable_school_zone: true,
  enable_speed_limit: true,
  enable_voice: true,
  announce_far_meters: 500,
  announce_near_meters: 200,
  overspeed_tolerance_kmh: 10,
  corridor_radius_meters: 25,
  min_confidence: 0.5,
  legal_status: "unknown",
};

type Bbox = { south: number; west: number; north: number; east: number };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: buildCorsHeaders(req) });
  if (req.method !== "POST") return json(req, { error: "method_not_allowed" }, 405);

  try {
    let url = "";
    try {
      url = getEdgeSupabaseUrl();
    } catch {
      url = "";
    }
    const serviceKey = getEdgeSecretKeyOptional();
    if (!url || !serviceKey) return json(req, { error: "server_misconfigured" }, 500);

    const body = (await req.json().catch(() => ({}))) as {
      bbox?: Bbox;
      countryCode?: string;
    };
    const bboxCheck = validateBbox(body.bbox, 2);
    if (!bboxCheck.ok) return json(req, { error: "invalid_bbox", reason: bboxCheck.reason }, 400);

    const bbox = body.bbox as Bbox;
    const countryCode = String(body.countryCode ?? "").trim().toUpperCase() || null;

    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false },
    });

    // Resolve per-country config (defaults applied when missing).
    let config = { ...DEFAULT_CONFIG };
    if (countryCode) {
      const { data: cfg } = await admin
        .from("road_safety_country_config")
        .select("*")
        .eq("country_code", countryCode)
        .eq("is_active", true)
        .maybeSingle();
      if (cfg) config = { ...config, ...cfg };
    }

    // Legal gating: camera categories only when legal_status === 'allowed'.
    const enabledTypes = resolveEnabledTypes(config);

    if (enabledTypes.length === 0) {
      return json(req, { events: [], config, attribution: ATTRIBUTION });
    }

    let query = admin
      .from("road_safety_events")
      .select(
        "id,type,latitude,longitude,country_code,source,source_ref,confidence,direction,bearing,speed_limit_kmh,schedule,updated_at",
      )
      .eq("is_active", true)
      .in("type", enabledTypes)
      .gte("latitude", bbox.south)
      .lte("latitude", bbox.north)
      .gte("longitude", bbox.west)
      .lte("longitude", bbox.east)
      .gte("confidence", config.min_confidence)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .limit(400);

    if (countryCode) {
      query = query.or(`country_code.is.null,country_code.eq.${countryCode}`);
    }

    const { data, error } = await query;
    if (error) return json(req, { error: "query_failed", details: error.message }, 500);

    return json(req, { events: data ?? [], config, attribution: ATTRIBUTION });
  } catch (error) {
    return json(req, 
      { error: "unexpected", details: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
