import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const { data, error } = await auth.supabaseAdmin
      .from("taxi_client_favorite_drivers")
      .select("id, driver_user_id, created_at")
      .eq("client_user_id", auth.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    return taxiJson({ ok: true, favorites: data ?? [] });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as {
      driver_user_id?: string;
      driverUserId?: string;
    };

    const driverUserId = String(
      body.driver_user_id ?? body.driverUserId ?? ""
    ).trim();

    if (!driverUserId) {
      return taxiJson({ ok: false, error: "Missing driver_user_id" }, 400);
    }

    if (driverUserId === auth.user.id) {
      return taxiJson({ ok: false, error: "Cannot favorite yourself" }, 400);
    }

    const { data: driverFeatures, error: driverError } = await auth.supabaseAdmin
      .from("taxi_driver_features")
      .select("user_id, taxi_enabled")
      .eq("user_id", driverUserId)
      .maybeSingle();

    if (driverError) {
      return taxiJson({ ok: false, error: driverError.message }, 500);
    }

    if (!driverFeatures?.taxi_enabled) {
      return taxiJson({ ok: false, error: "driver_not_taxi_enabled" }, 400);
    }

    const { data, error } = await auth.supabaseAdmin
      .from("taxi_client_favorite_drivers")
      .insert({
        client_user_id: auth.user.id,
        driver_user_id: driverUserId,
      })
      .select("id, driver_user_id, created_at")
      .maybeSingle();

    if (error) {
      if (error.code === "23505") {
        return taxiJson({ ok: true, already: true });
      }
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    return taxiJson({ ok: true, favorite: data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as {
      driver_user_id?: string;
      driverUserId?: string;
    };

    const driverUserId = String(
      body.driver_user_id ?? body.driverUserId ?? ""
    ).trim();

    if (!driverUserId) {
      return taxiJson({ ok: false, error: "Missing driver_user_id" }, 400);
    }

    const { error } = await auth.supabaseAdmin
      .from("taxi_client_favorite_drivers")
      .delete()
      .eq("client_user_id", auth.user.id)
      .eq("driver_user_id", driverUserId);

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    return taxiJson({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}
