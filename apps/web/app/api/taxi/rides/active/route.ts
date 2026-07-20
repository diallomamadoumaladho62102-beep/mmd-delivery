import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";

import { formatClientPreferencesForDriver } from "@/lib/taxiClientPreferences";
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
      `
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

    const ride = data
      ? {
          ...data,
          client_preference_lines: formatClientPreferencesForDriver({
            clientPreferences: data.client_preferences as Record<string, unknown>,
            preferElectricOrHybrid: data.prefer_electric_or_hybrid === true,
            ambiance: String(data.ambiance_preference ?? "none"),
          }),
        }
      : null;

    return taxiJson({ ok: true, ride });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}

export async function POST() {
  return taxiJson({ error: "Method not allowed" }, 405);
}
