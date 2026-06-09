import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageTaxiRides,
  assertStaffPermission,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { dispatchDueTaxiScheduledRide } from "@/lib/taxiScheduledDispatch";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_rides.read", request);
    const supabase = buildSupabaseAdminClient();

    const { data, error } = await supabase
      .from("taxi_scheduled_rides")
      .select(
        `
        *,
        taxi_rides:taxi_ride_id (
          id,
          status,
          payment_status,
          pickup_address,
          dropoff_address,
          total_cents,
          currency,
          client_user_id
        )
      `
      )
      .order("scheduled_pickup_at", { ascending: true })
      .limit(100);

    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, items: data ?? [] });
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
    const session = await assertCanManageTaxiRides(request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "").trim();
    const scheduledId = String(body.scheduled_id ?? body.scheduledId ?? "").trim();

    if (!scheduledId) return json({ ok: false, error: "Missing scheduled_id" }, 400);

    if (action === "force_dispatch") {
      const result = await dispatchDueTaxiScheduledRide({
        supabase,
        scheduledId,
        origin: request.nextUrl.origin,
      });

      await writeAdminAuditServer({
        supabaseAdmin: supabase,
        adminUserId: session.userId,
        action: "taxi_scheduled_force_dispatch",
        targetType: "taxi_scheduled_ride",
        targetId: scheduledId,
        metadata: { result },
        request,
      });

      return json({ ok: true, result });
    }

    if (action === "cancel") {
      const nowIso = new Date().toISOString();
      const { data: scheduled } = await supabase
        .from("taxi_scheduled_rides")
        .select("taxi_ride_id")
        .eq("id", scheduledId)
        .maybeSingle();

      await supabase
        .from("taxi_scheduled_rides")
        .update({
          status: "canceled",
          canceled_at: nowIso,
          cancel_reason: "admin_cancel",
          updated_at: nowIso,
        })
        .eq("id", scheduledId);

      if (scheduled?.taxi_ride_id) {
        await supabase
          .from("taxi_rides")
          .update({
            status: "canceled",
            cancelled_at: nowIso,
            cancelled_by: "admin",
            cancel_reason: "admin_cancel",
            updated_at: nowIso,
          })
          .eq("id", scheduled.taxi_ride_id);
      }

      await writeAdminAuditServer({
        supabaseAdmin: supabase,
        adminUserId: session.userId,
        action: "taxi_scheduled_canceled",
        targetType: "taxi_scheduled_ride",
        targetId: scheduledId,
        request,
      });

      return json({ ok: true });
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
