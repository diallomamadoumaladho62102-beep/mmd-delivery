import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { buildTaxiCustomerWaitView } from "@/lib/taxiWaitFare";
import { processWaitTimerClientNotifications } from "@/lib/waitTimerNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireTaxiApiUser(req);
  if (auth.ok === false) return auth.response;

  const rideId = String(new URL(req.url).searchParams.get("taxi_ride_id") ?? "").trim();
  if (!rideId) {
    return taxiJson({ ok: false, error: "taxi_ride_id_required" }, 400);
  }

  const { data, error } = await auth.supabaseAdmin
    .from("taxi_rides")
    .select(
      "id,status,client_user_id,created_by,user_id,currency,wait_timer_started_at,driver_arrived_at,started_at,free_wait_minutes,wait_fee_amount_cents,wait_fee_status,client_wait_arrived_notified_at,client_wait_fee_started_notified_at,client_wait_final_warning_notified_at",
    )
    .eq("id", rideId)
    .maybeSingle();

  if (error) return taxiJson({ ok: false, error: "wait_status_failed" }, 500);
  if (!data) return taxiJson({ ok: false, error: "ride_not_found" }, 404);

  const row = data as {
    id: string;
    status: string | null;
    client_user_id: string | null;
    created_by: string | null;
    user_id: string | null;
    currency: string | null;
    wait_timer_started_at: string | null;
    driver_arrived_at: string | null;
    started_at: string | null;
    free_wait_minutes: number | null;
    wait_fee_amount_cents: number | null;
    client_wait_arrived_notified_at: string | null;
    client_wait_fee_started_notified_at: string | null;
    client_wait_final_warning_notified_at: string | null;
  };

  const ownerIds = [row.client_user_id, row.created_by, row.user_id].filter(Boolean);
  if (!ownerIds.includes(auth.user.id)) {
    return taxiJson({ ok: false, error: "forbidden" }, 403);
  }

  const view = buildTaxiCustomerWaitView({
    status: String(row.status ?? ""),
    waitTimerStartedAt: row.wait_timer_started_at,
    driverArrivedAt: row.driver_arrived_at,
    startedAt: row.started_at,
    freeWaitMinutes: row.free_wait_minutes,
    storedWaitFeeCents: row.wait_fee_amount_cents,
  });

  await processWaitTimerClientNotifications(auth.supabaseAdmin, {
    entityType: "taxi_ride",
    entityId: rideId,
    clientUserIds: ownerIds as string[],
    entityKind: "taxi",
    timer: {
      remaining_free_seconds: view.remaining_free_seconds,
      can_charge_fees: view.wait_fee_cents > 0,
      max_fee_reached: view.max_fee_reached,
    },
    notificationFlags: {
      arrived: row.client_wait_arrived_notified_at,
      fee_started: row.client_wait_fee_started_notified_at,
      final_warning: row.client_wait_final_warning_notified_at,
    },
    justArrived: view.wait_active,
  });

  return taxiJson({
    ok: true,
    currency: String(row.currency ?? "USD").toUpperCase(),
    ...view,
  });
}

export async function POST() {
  return taxiJson({ ok: false, error: "method_not_allowed" }, 405);
}
