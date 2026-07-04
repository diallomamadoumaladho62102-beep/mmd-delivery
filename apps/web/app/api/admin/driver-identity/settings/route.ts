import { NextRequest } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { loadIdentitySettings, updateIdentitySettings } from "@/lib/driverIdentityService";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  try {
    await assertStaffPermission("drivers.identity.settings", req);
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return adminJson({ ok: false, error: error.message }, error.status);
    }
    throw error;
  }

  const admin = buildSupabaseAdminClient();
  const settings = await loadIdentitySettings(admin);
  return adminJson({ ok: true, settings });
}

export async function PATCH(req: NextRequest) {
  let staff;
  try {
    staff = await assertStaffPermission("drivers.identity.settings", req);
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return adminJson({ ok: false, error: error.message }, error.status);
    }
    throw error;
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const admin = buildSupabaseAdminClient();

  const patch: Record<string, unknown> = {};
  const boolFields = [
    "random_check_enabled",
    "require_on_new_device",
    "require_on_city_change",
    "require_on_country_change",
    "require_on_report",
    "require_on_first_online",
    "require_on_profile_photo_change",
    "require_on_phone_change",
    "require_after_suspension",
    "periodic_check_enabled",
    "manual_review_enabled",
  ] as const;

  for (const key of boolFields) {
    if (body[key] !== undefined) patch[key] = Boolean(body[key]);
  }

  const intFields = [
    "random_min_rides",
    "random_max_rides",
    "require_after_inactivity_days",
    "periodic_check_days",
    "verification_validity_days",
    "retention_days",
  ] as const;

  for (const key of intFields) {
    if (body[key] !== undefined) {
      const num = Number(body[key]);
      if (!Number.isFinite(num)) {
        return adminJson({ ok: false, error: `invalid_${key}` }, 400);
      }
      patch[key] = Math.floor(num);
    }
  }

  if (body.manual_review_risk_threshold !== undefined) {
    patch.manual_review_risk_threshold = Number(body.manual_review_risk_threshold);
  }

  if (body.default_provider !== undefined) {
    patch.default_provider = String(body.default_provider).trim().slice(0, 64);
  }

  try {
    const settings = await updateIdentitySettings(admin, patch, staff.userId);

    await writeAdminAuditServer({
      supabaseAdmin: admin,
      adminUserId: staff.userId,
      action: "driver_identity.update_settings",
      targetType: "driver_identity_settings",
      targetId: "1",
      metadata: patch,
      request: req,
    });

    return adminJson({ ok: true, settings });
  } catch (error) {
    console.error("update identity settings:", error);
    return adminJson({ ok: false, error: "update_settings_failed" }, 500);
  }
}
