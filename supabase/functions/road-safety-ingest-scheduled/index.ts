// deno-lint-ignore-file no-explicit-any
// Scheduled OpenStreetMap ingestion orchestrator. Triggered by a GitHub Action
// (daily). Reads active zones due for refresh, ingests each with an audit run,
// a no-overlap lock (unique 'running' run per zone), spacing between zones to
// respect provider limits, and per-zone error isolation.
//
// Auth: x-ingest-secret (server-only). Never called from the mobile app.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";
import { ingestBbox } from "../_shared/roadSafetyIngest.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Zone is due when never ingested, or older than its frequency window.
function isDue(zone: any, now: number): boolean {
  if (!zone.last_ingested_at) return true;
  const last = new Date(zone.last_ingested_at).getTime();
  const windowMs = (zone.frequency === "daily" ? 1 : 7) * 24 * 3600_000;
  return now - last >= windowMs;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const ingestSecret = Deno.env.get("ROAD_SAFETY_INGEST_SECRET");
  const provided = req.headers.get("x-ingest-secret");
  if (!ingestSecret || provided !== ingestSecret) return json({ error: "unauthorized" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "server_misconfigured" }, 500);

  const body = (await req.json().catch(() => ({}))) as { maxZones?: number; force?: boolean };
  // Keep batches small: the Edge Function wall-clock limit is 150s. The daily
  // cron rotates through zones over successive days (oldest-first ordering).
  const maxZones = Math.min(Math.max(Number(body.maxZones) || 3, 1), 8);
  // Stop starting new zones once we approach the wall-clock limit.
  const deadline = Date.now() + 115_000;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const now = Date.now();

  // Self-heal: release stale locks from any run that was killed mid-flight
  // (e.g. a previous timeout) so a zone is never permanently blocked.
  await admin
    .from("road_safety_ingest_runs")
    .update({ status: "failed", error: "stale_timeout", finished_at: new Date().toISOString() })
    .eq("status", "running")
    .lt("started_at", new Date(now - 10 * 60_000).toISOString());

  const { data: zones, error: zonesError } = await admin
    .from("road_safety_ingest_zones")
    .select("*")
    .eq("is_active", true)
    .order("last_ingested_at", { ascending: true, nullsFirst: true });
  if (zonesError) return json({ error: "zones_query_failed", details: zonesError.message }, 500);

  const due = (zones ?? []).filter((z: any) => body.force || isDue(z, now)).slice(0, maxZones);
  const results: any[] = [];

  for (const zone of due) {
    if (Date.now() > deadline) {
      results.push({ zone: zone.name, skipped: "time_budget_reached" });
      continue;
    }
    // Acquire lock: insert a 'running' run. Unique partial index blocks overlap.
    const { data: run, error: lockError } = await admin
      .from("road_safety_ingest_runs")
      .insert({ zone_id: zone.id, status: "running" })
      .select("id")
      .single();
    if (lockError) {
      results.push({ zone: zone.name, skipped: "already_running_or_locked" });
      continue;
    }

    try {
      const result = await ingestBbox(admin as any, {
        bbox: { south: zone.south, west: zone.west, north: zone.north, east: zone.east },
        countryCode: zone.country_code,
        ttlHours: zone.ttl_hours,
      });
      await admin
        .from("road_safety_ingest_runs")
        .update({
          status: "success",
          finished_at: new Date().toISOString(),
          fetched: result.fetched,
          mapped: result.mapped,
          upserted: result.upserted,
        })
        .eq("id", run.id);
      await admin
        .from("road_safety_ingest_zones")
        .update({ last_ingested_at: new Date().toISOString() })
        .eq("id", zone.id);
      results.push({ zone: zone.name, ...result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await admin
        .from("road_safety_ingest_runs")
        .update({ status: "failed", finished_at: new Date().toISOString(), error: message })
        .eq("id", run.id);
      results.push({ zone: zone.name, error: message });
      console.error(`[road-safety-ingest] zone ${zone.name} failed: ${message}`);
    }

    // Space out requests to respect Overpass fair-use limits.
    await sleep(1500);
  }

  const failed = results.filter((r) => r.error).length;
  return json({
    ok: failed === 0,
    processed: results.length,
    failed,
    results,
    attribution: "© OpenStreetMap contributors",
  });
});
