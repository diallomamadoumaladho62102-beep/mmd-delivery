import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageTaxiRides,
  assertStaffPermission,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  findTaxiRidesNeedingDispatchRetry,
  resolveRetryDispatchWave,
  retryTaxiRideDispatch,
} from "@/lib/retryTaxiRideDispatch";
import { resolveTaxiDispatchRetryDecision } from "@/lib/taxiSharedRideDispatch";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_rides.read", request);
    const supabase = buildSupabaseAdminClient();
    const orphanScan = await findTaxiRidesNeedingDispatchRetry(supabase, 50);

    return json({
      ok: true,
      count: orphanScan.rides.length,
      skipped: orphanScan.skipped.length,
      skipped_details: orphanScan.skipped,
      items: orphanScan.rides.map((ride) => ({
        ...ride,
        suggested_wave: resolveRetryDispatchWave(ride),
      })),
    });
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
    const body = await request.json().catch(() => ({}));

    const taxiRideId = String(
      (body as { taxiRideId?: string; taxi_ride_id?: string }).taxiRideId ??
        (body as { taxi_ride_id?: string }).taxi_ride_id ??
        ""
    ).trim();

    if (!taxiRideId) {
      return json({ ok: false, error: "Missing taxiRideId" }, 400);
    }

    const requestedWave = Number(
      (body as { wave?: number }).wave ?? 0
    );

    const { data: ride, error: rideError } = await supabase
      .from("taxi_rides")
      .select("id, status, dispatch_wave, payment_status, driver_id")
      .eq("id", taxiRideId)
      .maybeSingle();

    if (rideError) {
      return json({ ok: false, error: rideError.message }, 500);
    }

    if (!ride) {
      return json({ ok: false, error: "Taxi ride not found" }, 404);
    }

    if (ride.driver_id) {
      return json({ ok: false, error: "Ride already has a driver" }, 409);
    }

    const retryDecision = await resolveTaxiDispatchRetryDecision({
      supabase,
      taxiRideId,
    });

    if (!retryDecision.shouldRetry) {
      return json(
        {
          ok: false,
          error: retryDecision.skipReason ?? "dispatch_retry_not_eligible",
          dispatch_ride_id: retryDecision.dispatchRideId,
        },
        409
      );
    }

    const dispatchRideId = retryDecision.dispatchRideId;

    const { data: dispatchRide, error: dispatchRideError } = await supabase
      .from("taxi_rides")
      .select("id, status, dispatch_wave, payment_status, driver_id")
      .eq("id", dispatchRideId)
      .maybeSingle();

    if (dispatchRideError || !dispatchRide) {
      return json({ ok: false, error: "Dispatch target ride not found" }, 404);
    }

    const wave =
      requestedWave >= 1 && requestedWave <= 3
        ? requestedWave
        : resolveRetryDispatchWave({
            id: dispatchRideId,
            status: dispatchRide.status,
            dispatch_wave: dispatchRide.dispatch_wave,
            updated_at: null,
          });

    const result = await retryTaxiRideDispatch({
      supabase,
      taxiRideId: dispatchRideId,
      wave,
      actorId: session.userId,
      source: "admin:retry-dispatch",
    });

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "taxi_dispatch_retry",
      targetType: "taxi_ride",
      targetId: dispatchRideId,
      metadata: { wave, result, requested_ride_id: taxiRideId },
      request,
    });

    if (!result.ok) {
      return json(
        {
          ok: false,
          error: result.error ?? "Dispatch retry failed",
          wave,
          result,
        },
        500
      );
    }

    return json({ ok: true, wave, result });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
