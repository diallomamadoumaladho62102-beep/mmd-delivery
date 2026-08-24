import { NextRequest } from "next/server";
import {
  getProfileRole,
  requireTaxiApiUser,
  taxiJson,
} from "@/lib/taxiApi";
import {
  normalizeRatingCategories,
  sanitizeRatingFreeText,
  TAXI_CLIENT_RATES_DRIVER_CATEGORIES,
  TAXI_DRIVER_RATES_CLIENT_CATEGORIES,
  type TaxiRateeRole,
} from "@/lib/taxi/taxiRatingCategories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  rating?: number;
  comment?: string | null;
  free_text?: string | null;
  categories?: string[] | string;
  ratee_role?: TaxiRateeRole | string;
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
    const { data: ride } = await auth.supabaseAdmin
      .from("taxi_rides")
      .select("id, client_user_id, driver_id, status")
      .eq("id", rideId)
      .maybeSingle();
    if (!ride) return taxiJson({ ok: false, error: "ride_not_found" }, 404);

    const uid = auth.user.id;
    const isClient = String(ride.client_user_id ?? "") === uid;
    const isDriver = String(ride.driver_id ?? "") === uid;
    const isStaff = role === "admin" || role === "staff";
    if (!isClient && !isDriver && !isStaff) {
      return taxiJson({ ok: false, error: "forbidden" }, 403);
    }

    const { data, error } = await auth.supabaseAdmin
      .from("taxi_ride_ratings")
      .select(
        "id, rating, comment, free_text, categories, ratee_role, driver_id, client_id, rater_id, created_at",
      )
      .eq("taxi_ride_id", rideId)
      .eq("rater_id", uid);

    if (error) return taxiJson({ ok: false, error: error.message }, 500);

    return taxiJson({
      ok: true,
      ratings: data ?? [],
      categories: {
        rate_driver: TAXI_CLIENT_RATES_DRIVER_CATEGORIES,
        rate_client: TAXI_DRIVER_RATES_CLIENT_CATEGORIES,
      },
    });
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
    const freeText = sanitizeRatingFreeText(body.free_text ?? body.comment);
    // Never put free-text into Sentry — keep local only.
    void freeText;

    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return taxiJson({ ok: false, error: "rating_must_be_1_to_5" }, 400);
    }

    const { data: ride, error: rideErr } = await auth.supabaseAdmin
      .from("taxi_rides")
      .select("id, status, driver_id, client_user_id")
      .eq("id", rideId)
      .maybeSingle();

    if (rideErr) return taxiJson({ ok: false, error: rideErr.message }, 500);
    if (!ride) return taxiJson({ ok: false, error: "ride_not_found" }, 404);

    if (String(ride.status ?? "").toLowerCase() !== "completed") {
      return taxiJson({ ok: false, error: "ride_not_completed" }, 409);
    }

    const driverId = String(ride.driver_id ?? "").trim();
    const clientId = String(ride.client_user_id ?? "").trim();
    if (!driverId || !clientId) {
      return taxiJson({ ok: false, error: "missing_participants" }, 409);
    }

    const uid = auth.user.id;
    let rateeRole: TaxiRateeRole =
      String(body.ratee_role ?? "").toLowerCase() === "client"
        ? "client"
        : "driver";

    // Authorization: client rates driver; driver rates client; never self.
    if (rateeRole === "driver") {
      if (uid !== clientId) {
        return taxiJson({ ok: false, error: "only_client_rates_driver" }, 403);
      }
      if (uid === driverId) {
        return taxiJson({ ok: false, error: "cannot_rate_self" }, 403);
      }
    } else {
      if (uid !== driverId) {
        return taxiJson({ ok: false, error: "only_driver_rates_client" }, 403);
      }
      if (uid === clientId) {
        return taxiJson({ ok: false, error: "cannot_rate_self" }, 403);
      }
    }

    const allowed =
      rateeRole === "driver"
        ? TAXI_CLIENT_RATES_DRIVER_CATEGORIES
        : TAXI_DRIVER_RATES_CLIENT_CATEGORIES;
    const categories = normalizeRatingCategories(body.categories, allowed);

    const { data: existing } = await auth.supabaseAdmin
      .from("taxi_ride_ratings")
      .select("id")
      .eq("taxi_ride_id", rideId)
      .eq("rater_id", uid)
      .eq("ratee_role", rateeRole)
      .maybeSingle();

    if (existing?.id) {
      return taxiJson({ ok: false, error: "rating_already_exists" }, 409);
    }

    const nowIso = new Date().toISOString();
    const { data: inserted, error: insErr } = await auth.supabaseAdmin
      .from("taxi_ride_ratings")
      .insert({
        taxi_ride_id: rideId,
        rater_id: uid,
        driver_id: driverId,
        client_id: clientId,
        ratee_role: rateeRole,
        rating,
        comment: freeText,
        free_text: freeText,
        categories,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select(
        "id, taxi_ride_id, driver_id, client_id, ratee_role, rating, categories, created_at",
      )
      .maybeSingle();

    if (insErr) {
      if (String(insErr.code ?? "") === "23505") {
        return taxiJson({ ok: false, error: "rating_already_exists" }, 409);
      }
      return taxiJson({ ok: false, error: insErr.message }, 500);
    }

    // Do not return free_text to third parties; rater already knows it.
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
