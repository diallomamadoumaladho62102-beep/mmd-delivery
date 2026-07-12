import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { safeRequestJson } from "@/lib/safeRequestJson";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_drivers.read", request);
    const supabase = buildSupabaseAdminClient();
    const { data: rules, error } = await supabase
      .from("ride_safety_recording_rules")
      .select("*")
      .order("country_code", { ascending: true, nullsFirst: true });
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, rules: rules ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await assertStaffPermission("taxi_drivers.manage", request);
    const supabase = buildSupabaseAdminClient();
    const parsed = await safeRequestJson<Record<string, any>>(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const ruleId = String(body.rule_id ?? body.id ?? "").trim();
    if (!ruleId) return json({ ok: false, error: "rule_id_required" }, 400);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.client_audio_allowed !== undefined) {
      patch.client_audio_allowed = Boolean(body.client_audio_allowed);
    }
    if (body.driver_video_allowed !== undefined) {
      patch.driver_video_allowed = Boolean(body.driver_video_allowed);
    }
    if (body.retention_days !== undefined) {
      patch.retention_days = Number(body.retention_days);
    }
    if (body.is_active !== undefined) {
      patch.is_active = Boolean(body.is_active);
    }

    const { error } = await supabase
      .from("ride_safety_recording_rules")
      .update(patch)
      .eq("id", ruleId);
    if (error) return json({ ok: false, error: error.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "ride_safety_recording_rules_update",
      targetType: "ride_safety_recording_rules",
      targetId: ruleId,
      metadata: patch,
      request,
    });

    return json({ ok: true });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("taxi_drivers.manage", request);
    const supabase = buildSupabaseAdminClient();
    const parsed = await safeRequestJson<Record<string, any>>(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body;
    const countryCode = body.country_code ? String(body.country_code).trim().toUpperCase() : null;
    const stateCode = body.state_code ? String(body.state_code).trim().toUpperCase() : null;
    const city = body.city ? String(body.city).trim().toLowerCase() : null;

    const { data, error } = await supabase
      .from("ride_safety_recording_rules")
      .insert({
        country_code: countryCode,
        state_code: stateCode,
        city,
        client_audio_allowed: body.client_audio_allowed !== false,
        driver_video_allowed: body.driver_video_allowed !== false,
        retention_days: Number(body.retention_days ?? 14),
        is_active: true,
      })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") return json({ ok: false, error: "rule_already_exists" }, 409);
      return json({ ok: false, error: error.message }, 500);
    }

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "ride_safety_recording_rules_create",
      targetType: "ride_safety_recording_rules",
      targetId: String(data.id),
      metadata: { country_code: countryCode, state_code: stateCode, city },
      request,
    });

    return json({ ok: true, rule: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
