import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { safeRequestJson } from "@/lib/safeRequestJson";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

const LEGAL_STATUSES = ["allowed", "restricted", "unknown", "disabled"] as const;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_drivers.read", request);
    const supabase = buildSupabaseAdminClient();
    const { data, error } = await supabase
      .from("road_safety_country_config")
      .select("*")
      .order("country_code", { ascending: true });
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, configs: data ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

// Upsert a per-country config (create if missing) by country_code.
export async function PUT(request: NextRequest) {
  try {
    const session = await assertStaffPermission("taxi_drivers.manage", request);
    const supabase = buildSupabaseAdminClient();
    const parsed = await safeRequestJson<Record<string, unknown>>(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as Record<string, any>;

    const countryCode = String(body.country_code ?? "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode)) {
      return json({ ok: false, error: "invalid_country_code" }, 400);
    }

    const legalStatus = LEGAL_STATUSES.includes(body.legal_status)
      ? body.legal_status
      : "unknown";

    const row = {
      country_code: countryCode,
      enable_speed_camera: Boolean(body.enable_speed_camera),
      enable_red_light_camera: Boolean(body.enable_red_light_camera),
      enable_stop_sign: body.enable_stop_sign !== false,
      enable_school_zone: body.enable_school_zone !== false,
      enable_speed_limit: body.enable_speed_limit !== false,
      enable_voice: body.enable_voice !== false,
      announce_far_meters: clampInt(body.announce_far_meters, 100, 1500, 500),
      announce_near_meters: clampInt(body.announce_near_meters, 50, 800, 200),
      overspeed_tolerance_kmh: clampInt(body.overspeed_tolerance_kmh, 0, 40, 10),
      corridor_radius_meters: clampInt(body.corridor_radius_meters, 5, 80, 25),
      min_confidence: Math.min(Math.max(Number(body.min_confidence) || 0.5, 0), 1),
      legal_status: legalStatus,
      is_active: body.is_active !== false,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("road_safety_country_config")
      .upsert(row, { onConflict: "country_code" });
    if (error) return json({ ok: false, error: error.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "road_safety_country_config_upsert",
      targetType: "road_safety_country_config",
      targetId: countryCode,
      metadata: row,
      request,
    });

    return json({ ok: true });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
