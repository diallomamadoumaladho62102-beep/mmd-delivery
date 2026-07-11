// deno-lint-ignore-file no-explicit-any
// Manual OpenStreetMap (Overpass) ingestion for a single bbox. Server-side only
// (x-ingest-secret). Delegates fetch/map/upsert to the shared ingest routine.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";
import { validateBbox } from "../_shared/roadSafetyValidation.ts";
import { ingestBbox, type IngestBbox } from "../_shared/roadSafetyIngest.ts";

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
      bbox?: IngestBbox;
      countryCode?: string;
      ttlHours?: number;
    };

    // Manual ingest is capped tighter than the query API (Overpass load).
    const bboxCheck = validateBbox(body.bbox, 1);
    if (!bboxCheck.ok) return json({ error: "invalid_bbox", reason: bboxCheck.reason }, 400);

    const countryCode = String(body.countryCode ?? "").trim().toUpperCase() || null;
    const ttlHours = Math.min(Math.max(Number(body.ttlHours) || 168, 1), 720);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const result = await ingestBbox(admin as any, {
      bbox: body.bbox as IngestBbox,
      countryCode,
      ttlHours,
    });

    return json({ ok: true, ...result, attribution: "© OpenStreetMap contributors" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith("overpass_failed") ? 502 : 500;
    return json({ error: "ingest_failed", details: message }, status);
  }
});
