import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { safeRequestJson } from "@/lib/safeRequestJson";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

const EVENT_TYPES = [
  "speed_camera",
  "red_light_camera",
  "speed_limit",
  "stop_sign",
  "school_zone",
] as const;

const DIRECTIONS = ["forward", "backward", "both", "unknown"] as const;

// List recent events (optionally by country), for curation/audit.
export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_drivers.read", request);
    const supabase = buildSupabaseAdminClient();
    const country = request.nextUrl.searchParams.get("country");
    let query = supabase
      .from("road_safety_events")
      .select(
        "id,type,latitude,longitude,country_code,source,confidence,direction,speed_limit_kmh,is_active,updated_at,expires_at",
      )
      .order("updated_at", { ascending: false })
      .limit(200);
    if (country && /^[A-Z]{2}$/.test(country.toUpperCase())) {
      query = query.eq("country_code", country.toUpperCase());
    }
    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, events: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

// Create a curated (manual) event — source is forced to 'manual'.
export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("taxi_drivers.manage", request);
    const supabase = buildSupabaseAdminClient();
    const parsed = await safeRequestJson<Record<string, any>>(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;

    const type = EVENT_TYPES.includes(body.type) ? body.type : null;
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (!type) return json({ ok: false, error: "invalid_type" }, 400);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
      return json({ ok: false, error: "invalid_latitude" }, 400);
    }
    if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return json({ ok: false, error: "invalid_longitude" }, 400);
    }

    const countryCode = body.country_code
      ? String(body.country_code).trim().toUpperCase()
      : null;
    const direction = DIRECTIONS.includes(body.direction) ? body.direction : "unknown";

    const row = {
      type,
      latitude,
      longitude,
      country_code: countryCode,
      source: "manual",
      source_ref: `manual/${crypto.randomUUID()}`,
      confidence: Math.min(Math.max(Number(body.confidence) || 0.9, 0), 1),
      direction,
      speed_limit_kmh:
        body.speed_limit_kmh != null && Number.isFinite(Number(body.speed_limit_kmh))
          ? Number(body.speed_limit_kmh)
          : null,
      is_active: true,
    };

    const { data, error } = await supabase
      .from("road_safety_events")
      .insert(row)
      .select("id")
      .single();
    if (error) return json({ ok: false, error: error.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "road_safety_event_create",
      targetType: "road_safety_events",
      targetId: String(data.id),
      metadata: row,
      request,
    });

    return json({ ok: true, id: data.id });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

// Toggle active / deactivate an event.
export async function PATCH(request: NextRequest) {
  try {
    const session = await assertStaffPermission("taxi_drivers.manage", request);
    const supabase = buildSupabaseAdminClient();
    const parsed = await safeRequestJson<Record<string, any>>(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const id = String(body.id ?? "").trim();
    if (!id) return json({ ok: false, error: "id_required" }, 400);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
    if (body.confidence !== undefined) {
      patch.confidence = Math.min(Math.max(Number(body.confidence) || 0, 0), 1);
    }

    const { error } = await supabase.from("road_safety_events").update(patch).eq("id", id);
    if (error) return json({ ok: false, error: error.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "road_safety_event_update",
      targetType: "road_safety_events",
      targetId: id,
      metadata: patch,
      request,
    });

    return json({ ok: true });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
