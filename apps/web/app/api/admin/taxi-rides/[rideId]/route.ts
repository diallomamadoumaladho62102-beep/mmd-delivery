import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

type RouteContext = { params: Promise<{ rideId: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  try {
    await assertStaffPermission("taxi_rides.read", request);
    const { rideId } = await context.params;
    const id = String(rideId ?? "").trim();

    if (!id) return json({ ok: false, error: "Missing rideId" }, 400);

    const supabase = buildSupabaseAdminClient();

    const { data: ride, error: rideErr } = await supabase
      .from("taxi_rides")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (rideErr) return json({ ok: false, error: rideErr.message }, 500);
    if (!ride) return json({ ok: false, error: "Ride not found" }, 404);

    const [{ data: events }, { data: commission }] = await Promise.all([
      supabase
        .from("taxi_events")
        .select(
          "id, event_type, old_status, new_status, actor_id, triggered_role, description, metadata, created_at"
        )
        .eq("taxi_ride_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("taxi_commissions")
        .select(
          "id, driver_cents, platform_cents, total_cents, currency, driver_paid_out, driver_transfer_id, driver_paid_out_at"
        )
        .eq("taxi_ride_id", id)
        .maybeSingle(),
    ]);

    const profileIds = [ride.client_user_id, ride.driver_id].filter(Boolean) as string[];
    let profiles: Record<string, { id: string; full_name: string | null; phone: string | null }> =
      {};

    if (profileIds.length > 0) {
      const { data: profileRows } = await supabase
        .from("profiles")
        .select("id, full_name, phone")
        .in("id", profileIds);

      for (const row of profileRows ?? []) {
        profiles[row.id] = row;
      }
    }

    return json({
      ok: true,
      ride,
      events: events ?? [],
      commission: commission ?? null,
      client: ride.client_user_id ? profiles[ride.client_user_id] ?? null : null,
      driver: ride.driver_id ? profiles[ride.driver_id] ?? null : null,
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
