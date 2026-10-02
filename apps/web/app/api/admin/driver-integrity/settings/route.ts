import { NextRequest, NextResponse } from "next/server";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { isSuperAdmin } from "@/lib/adminRbac";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { asPositiveInt, asPositiveNumber } from "@/lib/driverIntegrity/engineGate";
import {
  mapIntegritySettingsRow,
  SENSITIVE_FLAG_KEYS,
} from "@/lib/driverIntegrity/settingsStore";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("driver_integrity.read", request);
    const supabase = buildSupabaseAdminClient();
    const { data, error } = await supabase
      .from("driver_integrity_settings")
      .select("*")
      .eq("singleton", true)
      .maybeSingle();
    if (error) return json({ ok: false, error: "settings_load_failed" }, 500);
    return json({
      ok: true,
      settings: mapIntegritySettingsRow(data as Record<string, unknown> | null),
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: "forbidden" }, status);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await assertStaffPermission("driver_integrity.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const reason = String(body.reason ?? "").trim();

    const { data: current } = await supabase
      .from("driver_integrity_settings")
      .select("*")
      .eq("singleton", true)
      .maybeSingle();

    if (current?.require_change_reason !== false && !reason) {
      return json({ ok: false, error: "reason_required" }, 400);
    }

    const enablingSensitive = SENSITIVE_FLAG_KEYS.some(
      (key) => body[key] === true && current?.[key] !== true
    );
    if (enablingSensitive && !session.isFounder && !isSuperAdmin(session.role)) {
      return json({ ok: false, error: "super_admin_required" }, 403);
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      updated_by: session.userId,
    };

    const flags = [
      "monitoring_enabled",
      "warning_notifications_enabled",
      "reassignment_enabled",
      "contact_enabled",
      "review_enabled",
      "sanction_workflow_enabled",
      "require_change_reason",
    ] as const;
    for (const key of flags) {
      if (body[key] !== undefined) patch[key] = body[key] === true;
    }

    const ints = [
      "driver_acceptance_warning_after_seconds",
      "driver_no_progress_reassignment_after_seconds",
      "driver_pickup_progress_warning_after_seconds",
      "driver_no_progress_review_after_seconds",
      "restaurant_wait_review_threshold_seconds",
      "long_trip_threshold_seconds",
      "stationary_threshold_seconds",
      "gps_stale_after_seconds",
      "gps_jump_threshold_meters",
      "movement_progress_threshold_meters",
    ] as const;
    for (const key of ints) {
      if (body[key] !== undefined) {
        if (body[key] === null || body[key] === "") patch[key] = null;
        else {
          const n = asPositiveInt(body[key]);
          if (n == null) return json({ ok: false, error: "invalid_threshold" }, 400);
          patch[key] = n;
        }
      }
    }
    if ("engine_start_at" in body) {
      const raw = body.engine_start_at;
      if (raw == null || raw === "") {
        patch.engine_start_at = null;
      } else {
        const iso = new Date(String(raw)).toISOString();
        if (Number.isNaN(Date.parse(iso))) {
          return json({ ok: false, error: "invalid_engine_start" }, 400);
        }
        patch.engine_start_at = iso;
      }
    }
    if (body.impossible_speed_threshold_mps !== undefined) {
      if (body.impossible_speed_threshold_mps === null || body.impossible_speed_threshold_mps === "") {
        patch.impossible_speed_threshold_mps = null;
      } else {
        const n = asPositiveNumber(body.impossible_speed_threshold_mps);
        if (n == null) return json({ ok: false, error: "invalid_threshold" }, 400);
        patch.impossible_speed_threshold_mps = n;
      }
    }

    const { data, error } = await supabase
      .from("driver_integrity_settings")
      .update(patch)
      .eq("singleton", true)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: "settings_save_failed" }, 500);

    await supabase.from("driver_integrity_settings_revisions").insert({
      snapshot: data ?? patch,
      change_reason: reason || null,
      created_by: session.userId,
    });

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "driver_integrity_settings_updated",
      targetType: "driver_integrity_settings",
      targetId: "singleton",
      oldValues: (current as Record<string, unknown> | null) ?? null,
      newValues: (data as Record<string, unknown> | null) ?? patch,
      metadata: { reason },
      request,
    });

    return json({
      ok: true,
      settings: mapIntegritySettingsRow(data as Record<string, unknown> | null),
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: "forbidden" }, status);
  }
}
