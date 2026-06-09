import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as {
      code?: string;
      total_cents?: number;
      totalCents?: number;
      taxi_ride_id?: string;
      taxiRideId?: string;
      vehicle_class?: string;
      vehicleClass?: string;
      country_code?: string;
      countryCode?: string;
      currency?: string;
    };

    const code = String(body.code ?? "").trim();
    if (!code) {
      return taxiJson({ ok: false, error: "Missing code" }, 400);
    }

    const totalCents = Math.round(
      Number(body.total_cents ?? body.totalCents ?? 0)
    );
    const rideId = String(body.taxi_ride_id ?? body.taxiRideId ?? "").trim() || null;

    const { data, error } = await auth.supabaseAdmin.rpc("validate_taxi_promotion", {
      p_code: code,
      p_user_id: auth.user.id,
      p_total_cents: totalCents > 0 ? totalCents : null,
      p_ride_id: rideId,
      p_vehicle_class: String(body.vehicle_class ?? body.vehicleClass ?? "") || null,
      p_country_code: String(body.country_code ?? body.countryCode ?? "") || null,
      p_currency: String(body.currency ?? "") || null,
    });

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    const result = (data ?? {}) as Record<string, unknown>;
    if (result.ok === false) {
      return taxiJson({ ok: false, ...result }, 400);
    }

    return taxiJson({ ok: true, ...result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}
