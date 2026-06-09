import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
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
    await assertStaffPermission("taxi_driver_quality.read", request);
    const supabase = buildSupabaseAdminClient();

    const { data: scores, error: scoresError } = await supabase
      .from("taxi_driver_quality_scores")
      .select(
        `
        *,
        taxi_driver_features:user_id (
          taxi_enabled,
          premium_eligible,
          vehicle_class
        )
      `
      )
      .order("quality_score", { ascending: false })
      .limit(200);

    if (scoresError) return json({ ok: false, error: scoresError.message }, 500);

    const { data: events, error: eventsError } = await supabase
      .from("taxi_driver_quality_events")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (eventsError) return json({ ok: false, error: eventsError.message }, 500);

    return json({ ok: true, scores: scores ?? [], events: events ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission(
      "taxi_driver_quality.manage",
      request
    );
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const action = String(body.action ?? "").trim();
    const driverId = String(body.driver_id ?? body.driverId ?? "").trim();

    if (!driverId) return json({ ok: false, error: "Missing driver_id" }, 400);

    if (action === "refresh") {
      const { data, error } = await supabase.rpc(
        "refresh_taxi_driver_quality_score",
        { p_driver_id: driverId }
      );
      if (error) return json({ ok: false, error: error.message }, 500);

      await writeAdminAuditServer({
        supabaseAdmin: supabase,
        adminUserId: session.userId,
        action: "taxi_driver_quality_refreshed",
        targetType: "taxi_driver",
        targetId: driverId,
        request,
      });

      return json({ ok: true, result: data });
    }

    if (action === "set_premium") {
      const premiumActive = body.premium_active === true || body.premiumActive === true;
      const { data, error } = await supabase.rpc("admin_set_taxi_driver_premium", {
        p_driver_id: driverId,
        p_premium_active: premiumActive,
        p_admin_id: session.userId,
      });
      if (error) return json({ ok: false, error: error.message }, 500);

      await writeAdminAuditServer({
        supabaseAdmin: supabase,
        adminUserId: session.userId,
        action: premiumActive
          ? "taxi_driver_premium_promoted"
          : "taxi_driver_premium_demoted",
        targetType: "taxi_driver",
        targetId: driverId,
        request,
      });

      return json({ ok: true, result: data });
    }

    return json({ ok: false, error: "Unknown action" }, 400);
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
