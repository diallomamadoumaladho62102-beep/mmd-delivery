import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageTaxiDrivers,
  assertStaffPermission,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_drivers.read", request);
    const supabase = buildSupabaseAdminClient();
    const limit = Math.min(
      Math.max(Number(request.nextUrl.searchParams.get("limit") ?? 100), 1),
      200
    );
    const q = request.nextUrl.searchParams.get("q")?.trim();

    let featuresQuery = supabase
      .from("taxi_driver_features")
      .select(
        `user_id, taxi_enabled, vehicle_class, vehicle_make, vehicle_model,
         vehicle_year, vehicle_plate, vehicle_color, passenger_capacity,
         xl_eligible, premium_eligible, stripe_connect_account_id, updated_at`
      )
      .order("updated_at", { ascending: false })
      .limit(limit);

    const { data: features, error: featErr } = await featuresQuery;

    if (featErr) return json({ ok: false, error: featErr.message }, 500);

    const userIds = (features ?? []).map((f) => f.user_id);
    if (userIds.length === 0) {
      return json({ ok: true, items: [] });
    }

    let profilesQuery = supabase
      .from("profiles")
      .select("id, full_name, phone, role, account_status")
      .in("id", userIds);

    if (q) {
      profilesQuery = profilesQuery.or(`full_name.ilike.%${q}%,phone.ilike.%${q}%`);
    }

    const { data: profiles, error: profErr } = await profilesQuery;

    if (profErr) return json({ ok: false, error: profErr.message }, 500);

    const profileMap = new Map((profiles ?? []).map((p) => [p.id, p]));

    const items = (features ?? [])
      .map((f) => ({
        ...f,
        profile: profileMap.get(f.user_id) ?? null,
      }))
      .filter((row) => !q || row.profile != null);

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
    const session = await assertCanManageTaxiDrivers(request);
    const supabase = buildSupabaseAdminClient();
    const body = await request.json().catch(() => ({}));

    const userId = String((body as { user_id?: string }).user_id ?? "").trim();
    if (!userId) return json({ ok: false, error: "Missing user_id" }, 400);

    const { data: existing, error: readErr } = await supabase
      .from("taxi_driver_features")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (readErr) return json({ ok: false, error: readErr.message }, 500);

    const patch = body as Record<string, unknown>;
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (typeof patch.taxi_enabled === "boolean") update.taxi_enabled = patch.taxi_enabled;
    if (typeof patch.xl_eligible === "boolean") update.xl_eligible = patch.xl_eligible;
    if (typeof patch.premium_eligible === "boolean") {
      update.premium_eligible = patch.premium_eligible;
    }

    const vehicleClass = String(patch.vehicle_class ?? "").trim();
    if (vehicleClass && ["standard", "xl", "premium"].includes(vehicleClass)) {
      update.vehicle_class = vehicleClass;
    }

    if (patch.passenger_capacity != null) {
      update.passenger_capacity = Math.max(1, Math.round(Number(patch.passenger_capacity)));
    }

    const vehicleFields = [
      "vehicle_make",
      "vehicle_model",
      "vehicle_plate",
      "vehicle_color",
    ] as const;
    for (const field of vehicleFields) {
      if (typeof patch[field] === "string") update[field] = patch[field];
    }
    if (patch.vehicle_year != null) {
      update.vehicle_year = Math.round(Number(patch.vehicle_year));
    }

    let result;

    if (existing) {
      const { data: updated, error: updateErr } = await supabase
        .from("taxi_driver_features")
        .update(update)
        .eq("user_id", userId)
        .select("*")
        .maybeSingle();

      if (updateErr) return json({ ok: false, error: updateErr.message }, 500);
      result = updated;
    } else {
      const insertRow = {
        user_id: userId,
        taxi_enabled: false,
        vehicle_class: "standard",
        passenger_capacity: 4,
        xl_eligible: false,
        premium_eligible: false,
        ...update,
      };

      const { data: inserted, error: insertErr } = await supabase
        .from("taxi_driver_features")
        .insert(insertRow)
        .select("*")
        .maybeSingle();

      if (insertErr) return json({ ok: false, error: insertErr.message }, 500);
      result = inserted;
    }

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "taxi_driver_updated",
      targetType: "taxi_driver",
      targetId: userId,
      oldValues: (existing ?? {}) as Record<string, unknown>,
      newValues: (result ?? update) as Record<string, unknown>,
      request,
    });

    return json({ ok: true, item: result });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
