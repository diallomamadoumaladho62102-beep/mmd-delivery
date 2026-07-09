import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManagePlatformLaunch,
  assertStaffPermission,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { buildPlatformLaunchPatchUpdate } from "@/lib/adminPlatformLaunchPatch";

export const dynamic = "force-dynamic";

const COUNTY_SELECT =
  "id, country_code, region_code, county_code, county_name, platform_enabled, taxi_enabled, delivery_enabled, restaurant_enabled, marketplace_enabled, seller_enabled, checkout_enabled, payout_enabled, maintenance_mode, launch_status, created_at, updated_at";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function normalizeCountryCode(value: string) {
  return value.trim().toUpperCase();
}

function normalizeRegionCode(value: string) {
  return value.trim().toLowerCase();
}

function normalizeCountyCode(value: string) {
  return value.trim().toLowerCase();
}

export async function GET(
  request: NextRequest,
  context: {
    params: Promise<{ country_code: string; region_code: string; county_code: string }>;
  }
) {
  try {
    await assertStaffPermission("platform_launch.read", request);
    const { country_code, region_code, county_code } = await context.params;
    const countryCode = normalizeCountryCode(country_code);
    const regionCode = normalizeRegionCode(region_code);
    const countyCode = normalizeCountyCode(county_code);

    const supabase = buildSupabaseAdminClient();
    const { data, error } = await supabase
      .from("platform_counties")
      .select(COUNTY_SELECT)
      .eq("country_code", countryCode)
      .eq("region_code", regionCode)
      .eq("county_code", countyCode)
      .maybeSingle();

    if (error) return json({ ok: false, error: error.message }, 500);
    if (!data) return json({ ok: false, error: "County not found" }, 404);

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
  context: {
    params: Promise<{ country_code: string; region_code: string; county_code: string }>;
  }
) {
  try {
    const session = await assertCanManagePlatformLaunch(request);
    const { country_code, region_code, county_code } = await context.params;
    const countryCode = normalizeCountryCode(country_code);
    const regionCode = normalizeRegionCode(region_code);
    const countyCode = normalizeCountyCode(county_code);

    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const { data: existing, error: readErr } = await supabase
      .from("platform_counties")
      .select(COUNTY_SELECT)
      .eq("country_code", countryCode)
      .eq("region_code", regionCode)
      .eq("county_code", countyCode)
      .maybeSingle();

    if (readErr) return json({ ok: false, error: readErr.message }, 500);
    if (!existing) return json({ ok: false, error: "County not found" }, 404);

    const patchResult = buildPlatformLaunchPatchUpdate(
      existing as Record<string, unknown>,
      body
    );
    if (patchResult.ok === false) {
      return json({ ok: false, error: patchResult.error }, 400);
    }
    const update = patchResult.update;

    // Counties do not store marketplace live certification flags.
    delete update.marketplace_checkout_live_enabled;
    delete update.marketplace_dispatch_live_enabled;
    delete update.marketplace_payouts_live_enabled;

    const { data: updated, error: updateErr } = await supabase
      .from("platform_counties")
      .update(update)
      .eq("country_code", countryCode)
      .eq("region_code", regionCode)
      .eq("county_code", countyCode)
      .select(COUNTY_SELECT)
      .maybeSingle();

    if (updateErr) return json({ ok: false, error: updateErr.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "platform_county_updated",
      targetType: "platform_counties",
      targetId: `${countryCode}/${regionCode}/${countyCode}`,
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
