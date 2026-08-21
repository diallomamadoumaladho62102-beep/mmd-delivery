import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

import { formatClientPreferencesForDriver } from "@/lib/taxiClientPreferences";
import { buildTaxiDriverClientDisplay } from "@/lib/taxiDriverClientDisplay";
import { applyLiveTripFilters } from "@/lib/tripVisibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE_STATUSES = ["accepted", "driver_arrived", "in_progress"];

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const { data, error } = await applyLiveTripFilters(
      auth.supabaseAdmin
        .from("taxi_rides")
        .select(
          `
        *,
        taxi_ride_stops (
          id,
          stop_order,
          address,
          lat,
          lng,
          status
        )
      `,
        ),
    )
      .eq("driver_id", auth.user.id)
      .in("status", ACTIVE_STATUSES)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    // Never expose boarding OTP to the driver — client must communicate it.
    let ride: Record<string, unknown> | null = null;
    if (data) {
      const {
        pickup_verification_code: _omitPickupCode,
        ...safeRide
      } = data as Record<string, unknown> & {
        pickup_verification_code?: string | null;
      };
      void _omitPickupCode;

      let client_display: {
        full_name: string | null;
        avatar_url: string | null;
      } | null = null;

      const clientUserId = String(
        (safeRide as { client_user_id?: string | null }).client_user_id ?? "",
      ).trim();
      if (clientUserId) {
        const { data: profile } = await auth.supabaseAdmin
          .from("profiles")
          .select("full_name, avatar_url")
          .eq("id", clientUserId)
          .maybeSingle();

        client_display = buildTaxiDriverClientDisplay({
          rideStatus: String((safeRide as { status?: string }).status ?? ""),
          driverId: String(
            (safeRide as { driver_id?: string | null }).driver_id ?? "",
          ),
          viewerDriverId: auth.user.id,
          clientUserId,
          profile: profile ?? null,
        });
      }

      ride = {
        ...safeRide,
        client_preference_lines: formatClientPreferencesForDriver({
          clientPreferences: data.client_preferences as Record<
            string,
            unknown
          >,
          preferElectricOrHybrid: data.prefer_electric_or_hybrid === true,
          ambiance: String(data.ambiance_preference ?? "none"),
        }),
        client_display,
      };
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
