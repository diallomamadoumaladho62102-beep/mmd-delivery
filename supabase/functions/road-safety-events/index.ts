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

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
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
};

type Bbox = { south: number; west: number; north: number; east: number };

function validBbox(b: any): b is Bbox {
  return (
    b &&
    [b.south, b.west, b.north, b.east].every((v) => Number.isFinite(v)) &&
    b.south <= b.north &&
    b.west <= b.east &&
    b.north - b.south <= 2 &&
    b.east - b.west <= 2
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !serviceKey) return json({ error: "server_misconfigured" }, 500);

    const body = (await req.json().catch(() => ({}))) as {
      bbox?: Bbox;
      countryCode?: string;
    };
    if (!validBbox(body.bbox)) return json({ error: "invalid_bbox" }, 400);

    const bbox = body.bbox;
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

    const enabledTypes: string[] = [];
    if (config.enable_speed_camera) enabledTypes.push("speed_camera");
    if (config.enable_red_light_camera) enabledTypes.push("red_light_camera");
    if (config.enable_stop_sign) enabledTypes.push("stop_sign");
    if (config.enable_school_zone) enabledTypes.push("school_zone");
    if (config.enable_speed_limit) enabledTypes.push("speed_limit");

    if (enabledTypes.length === 0) {
      return json({ events: [], config, attribution: ATTRIBUTION });
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
    if (error) return json({ error: "query_failed", details: error.message }, 500);

    return json({ events: data ?? [], config, attribution: ATTRIBUTION });
  } catch (error) {
    return json(
      { error: "unexpected", details: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
