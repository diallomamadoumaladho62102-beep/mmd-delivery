import { NextRequest } from "next/server";
import {
  assertClientOwnsTaxiRide,
  getProfileRole,
  requireTaxiApiUser,
  taxiJson,
} from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  rating?: number;
  comment?: string | null;
};

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const { id: rideId } = await ctx.params;
    if (!rideId) return taxiJson({ ok: false, error: "Missing ride id" }, 400);

    const role = await getProfileRole(auth.supabaseAdmin, auth.user.id);
    const scope = await assertClientOwnsTaxiRide({
      supabaseAdmin: auth.supabaseAdmin,
      rideId,
      userId: auth.user.id,
      role,
    });
    if (scope.ok === false) {
      return taxiJson({ ok: false, error: scope.error }, scope.status);
    }

    const { data, error } = await auth.supabaseAdmin
      .from("taxi_ride_ratings")
      .select("id, rating, comment, driver_id, created_at, updated_at")
      .eq("taxi_ride_id", rideId)
      .eq("rater_id", auth.user.id)
      .maybeSingle();

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    return taxiJson({ ok: true, rating: data ?? null });
  } catch (e: unknown) {
    return taxiJson(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500,
    );
  }
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const { id: rideId } = await ctx.params;
    if (!rideId) return taxiJson({ ok: false, error: "Missing ride id" }, 400);

    const body = (await req.json().catch(() => ({}))) as Body;
    const rating = Math.round(Number(body.rating));
    const comment =
      body.comment == null ? null : String(body.comment).trim().slice(0, 500) || null;

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return taxiJson({ ok: false, error: "rating_must_be_1_to_5" }, 400);
    }

    const role = await getProfileRole(auth.supabaseAdmin, auth.user.id);
    const scope = await assertClientOwnsTaxiRide({
      supabaseAdmin: auth.supabaseAdmin,
      rideId,
      userId: auth.user.id,
      role,
    });
    if (scope.ok === false) {
      return taxiJson({ ok: false, error: scope.error }, scope.status);
    }

    const { data: ride, error: rideErr } = await auth.supabaseAdmin
      .from("taxi_rides")
      .select("id, status, driver_id, client_user_id, created_by")
      .eq("id", rideId)
      .maybeSingle();

    if (rideErr) {
      return taxiJson({ ok: false, error: rideErr.message }, 500);
    }
    if (!ride) {
      return taxiJson({ ok: false, error: "ride_not_found" }, 404);
    }

    if (String(ride.status ?? "").toLowerCase() !== "completed") {
      return taxiJson({ ok: false, error: "ride_not_completed" }, 409);
    }

    const driverId = String(ride.driver_id ?? "").trim();
    if (!driverId) {
      return taxiJson({ ok: false, error: "missing_driver" }, 409);
    }

    const nowIso = new Date().toISOString();
    const { data: existing } = await auth.supabaseAdmin
      .from("taxi_ride_ratings")
      .select("id, rating")
      .eq("taxi_ride_id", rideId)
      .eq("rater_id", auth.user.id)
      .maybeSingle();

    if (existing?.id) {
      return taxiJson(
        {
          ok: false,
          error: "rating_already_exists",
          rating: existing,
        },
        409,
      );
    }

    const { data: inserted, error: insErr } = await auth.supabaseAdmin
      .from("taxi_ride_ratings")
      .insert({
        taxi_ride_id: rideId,
        rater_id: auth.user.id,
        driver_id: driverId,
        rating,
        comment,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("id, taxi_ride_id, driver_id, rating, comment, created_at, updated_at")
      .maybeSingle();

    if (insErr) {
      // Unique race → treat as update path
      if (String(insErr.code ?? "") === "23505") {
        return taxiJson({ ok: false, error: "rating_already_exists" }, 409);
      }
      return taxiJson({ ok: false, error: insErr.message }, 500);
    }

    return taxiJson({
      ok: true,
      created: true,
      rating: inserted,
    });
  } catch (e: unknown) {
    return taxiJson(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500,
    );
  }
}
