import { NextRequest } from "next/server";
import {
  assertClientOwnsTaxiRide,
  getProfileRole,
  isStaffRole,
  requireTaxiApiUser,
  taxiJson,
} from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const { id } = await context.params;
    const rideId = String(id ?? "").trim();

    if (!/^[0-9a-f-]{36}$/i.test(rideId)) {
      return taxiJson({ ok: false, error: "Invalid taxi ride id" }, 400);
    }

    const role = await getProfileRole(auth.supabaseAdmin, auth.user.id);

    if (!isStaffRole(role)) {
      const scope = await assertClientOwnsTaxiRide({
        supabaseAdmin: auth.supabaseAdmin,
        rideId,
        userId: auth.user.id,
        role,
      });

      if (scope.ok === false) {
        return taxiJson({ ok: false, error: scope.error }, scope.status);
      }

      const { data: driverRide } = await auth.supabaseAdmin
        .from("taxi_rides")
        .select("id")
        .eq("id", rideId)
        .eq("driver_id", auth.user.id)
        .maybeSingle();

      if (!driverRide) {
        const { data: clientRide } = await auth.supabaseAdmin
          .from("taxi_rides")
          .select("id, client_user_id")
          .eq("id", rideId)
          .maybeSingle();

        if (!clientRide || String(clientRide.client_user_id) !== auth.user.id) {
          return taxiJson({ ok: false, error: "Forbidden" }, 403);
        }
      }
    }

    const { data: ride, error } = await auth.supabaseAdmin
      .from("taxi_rides")
      .select("*")
      .eq("id", rideId)
      .maybeSingle();

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    if (!ride) {
      return taxiJson({ ok: false, error: "Taxi ride not found" }, 404);
    }

    return taxiJson({ ok: true, ride });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function POST() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
