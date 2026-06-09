import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageTaxiLaunch,
  assertStaffPermission,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const SELECT =
  "country_code, name, currency_code, active, launch_status, checkout_enabled, payout_enabled, shared_enabled, business_enabled, scheduled_enabled, premium_enabled, sort_order, updated_at";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_launch.read", request);
    const supabase = buildSupabaseAdminClient();

    const [countriesRes, marketRes] = await Promise.all([
      supabase
        .from("taxi_countries")
        .select(SELECT)
        .order("sort_order", { ascending: true })
        .order("country_code", { ascending: true }),
      supabase
        .from("taxi_market_metrics")
        .select("*")
        .order("snapshot_at", { ascending: false })
        .limit(50),
    ]);

    if (countriesRes.error) {
      return json({ ok: false, error: countriesRes.error.message }, 500);
    }

    const latestSnapshotAt = marketRes.data?.[0]?.snapshot_at ?? null;
    const readinessByCountry = new Map<string, Record<string, unknown>>();
    for (const row of marketRes.data ?? []) {
      if (latestSnapshotAt && row.snapshot_at !== latestSnapshotAt) continue;
      readinessByCountry.set(String(row.country_code), row);
    }

    const items = (countriesRes.data ?? []).map((country) => ({
      ...country,
      readiness: readinessByCountry.get(String(country.country_code)) ?? null,
    }));

    return json({ ok: true, items });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await assertCanManageTaxiLaunch(request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const countryCode = String(body.country_code ?? body.countryCode ?? "")
      .trim()
      .toUpperCase();

    if (!countryCode) {
      return json({ ok: false, error: "Missing country_code" }, 400);
    }

    const { data: existing, error: readErr } = await supabase
      .from("taxi_countries")
      .select(SELECT)
      .eq("country_code", countryCode)
      .maybeSingle();

    if (readErr) return json({ ok: false, error: readErr.message }, 500);
    if (!existing) return json({ ok: false, error: "Country not found" }, 404);

    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    const launchStatus = String(body.launch_status ?? body.launchStatus ?? "").trim();
    if (launchStatus === "enabled" || launchStatus === "disabled" || launchStatus === "maintenance") {
      update.launch_status = launchStatus;
    }

    for (const key of [
      "checkout_enabled",
      "payout_enabled",
      "shared_enabled",
      "business_enabled",
      "scheduled_enabled",
      "premium_enabled",
      "active",
    ] as const) {
      if (typeof body[key] === "boolean") update[key] = body[key];
    }

    const { data: updated, error: updateErr } = await supabase
      .from("taxi_countries")
      .update(update)
      .eq("country_code", countryCode)
      .select(SELECT)
      .maybeSingle();

    if (updateErr) return json({ ok: false, error: updateErr.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "taxi_launch_updated",
      targetType: "taxi_countries",
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
