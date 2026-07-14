import { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { resolveDispatchAccess } from "@/lib/dispatchInternalAuth";
import { runTaxiRideDispatch } from "@/lib/runTaxiRideDispatch";
import { getProfileRole, isStaffRole, taxiJson } from "@/lib/taxiApi";
import { assertPlatformFeature } from "@/lib/platformLaunchControl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function assertUserMayDispatchTaxiRide(params: {
  access: { mode: "internal" } | { mode: "user"; userId: string; role: string };
  ride: { client_user_id?: unknown };
}): { ok: true } | { ok: false; status: number; error: string } {
  if (params.access.mode === "internal") {
    return { ok: true };
  }

  const { userId, role } = params.access;
  const normalizedRole = normalize(role);

  if (
    normalizedRole === "admin" ||
    normalizedRole === "ops" ||
    normalizedRole === "support" ||
    normalizedRole === "finance" ||
    normalizedRole === "review"
  ) {
    return { ok: true };
  }

  if (normalizedRole === "client") {
    if (String(params.ride.client_user_id ?? "") === userId) {
      return { ok: true };
    }
    return { ok: false, status: 403, error: "Forbidden" };
  }

  return { ok: false, status: 403, error: "Forbidden" };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const taxiRideId = String(
      body.taxiRideId ?? body.taxi_ride_id ?? body.rideId ?? ""
    ).trim();

    const requestedWave = Math.min(Math.max(Number(body.wave ?? 1), 0), 3);
    const locationFreshMinutes = Math.min(
      Number(body.locationFreshMinutes ?? 20),
      120
    );

    if (!taxiRideId) {
      return taxiJson({ error: "Missing taxiRideId" }, 400);
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
      { auth: { persistSession: false } }
    );

    const accessResult = await resolveDispatchAccess(req, supabase);
    if (accessResult.ok === false) {
      return taxiJson({ error: accessResult.error }, accessResult.status);
    }

    const { data: ride, error: rideError } = await supabase
      .from("taxi_rides")
      .select("id,client_user_id,payment_status,status,driver_id,country_code")
      .eq("id", taxiRideId)
      .maybeSingle();

    if (rideError) {
      return taxiJson({ error: rideError.message }, 500);
    }

    if (!ride) {
      return taxiJson({ error: "Taxi ride not found" }, 404);
    }

    const scopeResult = assertUserMayDispatchTaxiRide({
      access: accessResult.access,
      ride,
    });

    if (scopeResult.ok === false) {
      return taxiJson({ error: scopeResult.error }, scopeResult.status);
    }

    const platformCheck = await assertPlatformFeature(
      supabase,
      String(ride.country_code ?? "US"),
      "taxi",
      "active"
    );
    if (platformCheck.ok === false) {
      return taxiJson({ ok: false, ...platformCheck }, 403);
    }

    const result = await runTaxiRideDispatch({
      supabase,
      taxiRideId,
      wave: requestedWave,
      locationFreshMinutes,
    });

    if (
      accessResult.access.mode === "user" &&
      isStaffRole(await getProfileRole(supabase, accessResult.access.userId))
    ) {
      await writeAdminAuditServer({
        supabaseAdmin: supabase,
        adminUserId: accessResult.access.userId,
        action: "dispatch_triggered",
        targetType: "taxi_ride",
        targetId: taxiRideId,
        metadata: { wave: requestedWave, module: "taxi", result },
        request: req,
      });
    }

    if (!result.ok) {
      return taxiJson(
        {
          ok: false,
          taxiRideId,
          error: result.error ?? "Dispatch failed",
        },
        500
      );
    }

    return taxiJson({ ok: true, ...result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ error: message }, 500);
  }
}

export async function GET() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
