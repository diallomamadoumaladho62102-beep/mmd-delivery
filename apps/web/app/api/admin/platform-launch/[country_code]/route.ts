import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManagePlatformLaunch,
  assertStaffPermission,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import type { PlatformLaunchStatus } from "@/lib/platformLaunchControl";

export const dynamic = "force-dynamic";

const SELECT =
  "id, country_code, country_name, continent, region, platform_enabled, taxi_enabled, delivery_enabled, restaurant_enabled, checkout_enabled, payout_enabled, maintenance_mode, launch_status, created_at, updated_at";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function normalizeCountryCode(value: string) {
  return value.trim().toUpperCase();
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ country_code: string }> }
) {
  try {
    await assertStaffPermission("platform_launch.read", request);
    const { country_code } = await context.params;
    const countryCode = normalizeCountryCode(country_code);

    const supabase = buildSupabaseAdminClient();
    const { data, error } = await supabase
      .from("platform_countries")
      .select(SELECT)
      .eq("country_code", countryCode)
      .maybeSingle();

    if (error) return json({ ok: false, error: error.message }, 500);
    if (!data) return json({ ok: false, error: "Country not found" }, 404);

    return json({ ok: true, item: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ country_code: string }> }
) {
  try {
    const session = await assertCanManagePlatformLaunch(request);
    const { country_code } = await context.params;
    const countryCode = normalizeCountryCode(country_code);

    if (!countryCode) {
      return json({ ok: false, error: "Missing country_code" }, 400);
    }

    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const { data: existing, error: readErr } = await supabase
      .from("platform_countries")
      .select(SELECT)
      .eq("country_code", countryCode)
      .maybeSingle();

    if (readErr) return json({ ok: false, error: readErr.message }, 500);
    if (!existing) return json({ ok: false, error: "Country not found" }, 404);

    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    for (const key of [
      "platform_enabled",
      "taxi_enabled",
      "delivery_enabled",
      "restaurant_enabled",
      "checkout_enabled",
      "payout_enabled",
      "maintenance_mode",
    ] as const) {
      if (typeof body[key] === "boolean") update[key] = body[key];
    }

    const launchStatus = String(body.launch_status ?? body.launchStatus ?? "").trim();
    if (
      launchStatus === "enabled" ||
      launchStatus === "disabled" ||
      launchStatus === "maintenance"
    ) {
      update.launch_status = launchStatus as PlatformLaunchStatus;
    }

    if (typeof body.maintenance_mode === "boolean") {
      update.maintenance_mode = body.maintenance_mode;
      if (body.maintenance_mode === true) {
        update.launch_status = "maintenance";
      } else if (existing.launch_status === "maintenance" && body.launch_status == null) {
        update.launch_status = existing.platform_enabled ? "enabled" : "disabled";
      }
    }

    if (body.platform_enabled === false) {
      update.launch_status = "disabled";
    } else if (body.platform_enabled === true && existing.launch_status === "disabled") {
      update.launch_status = "enabled";
      if (typeof body.maintenance_mode !== "boolean" || body.maintenance_mode === false) {
        update.maintenance_mode = false;
      }
    }

    const { data: updated, error: updateErr } = await supabase
      .from("platform_countries")
      .update(update)
      .eq("country_code", countryCode)
      .select(SELECT)
      .maybeSingle();

    if (updateErr) return json({ ok: false, error: updateErr.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "platform_launch_updated",
      targetType: "platform_countries",
      targetId: countryCode,
      oldValues: existing as Record<string, unknown>,
      newValues: (updated ?? update) as Record<string, unknown>,
      request,
    });

    return json({ ok: true, item: updated });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
