import type { SupabaseClient } from "@supabase/supabase-js";
import { shouldAdvancePreferenceStage } from "./taxiClientPreferences";

export async function maybeAdvanceTaxiPreferenceStage(
  supabase: SupabaseClient,
  taxiRideId: string,
): Promise<{ advanced: boolean; clientMessage?: string | null }> {
  const { data: ride } = await supabase
    .from("taxi_rides")
    .select(
      "id,preferences_stage_until,preferences_dispatch_stage,driver_id,status,preferences_client_message",
    )
    .eq("id", taxiRideId)
    .maybeSingle();

  if (!ride || ride.driver_id) {
    return { advanced: false };
  }

  if (!shouldAdvancePreferenceStage({ stageUntil: ride.preferences_stage_until ?? null })) {
    return { advanced: false };
  }

  const { data: result, error } = await supabase.rpc("advance_taxi_preference_dispatch_stage", {
    p_ride_id: taxiRideId,
  });

  if (error) {
    console.log("[taxi preferences] advance stage error:", error.message);
    return { advanced: false };
  }

  const payload = result as {
    advanced?: boolean;
    client_message?: string | null;
  };

  return {
    advanced: payload?.advanced === true,
    clientMessage: payload?.client_message ?? ride.preferences_client_message ?? null,
  };
}

export async function initializeTaxiRidePreferenceDispatch(
  supabase: SupabaseClient,
  taxiRideId: string,
  countryCode: string | null,
): Promise<void> {
  await supabase.rpc("initialize_taxi_ride_preference_dispatch", {
    p_ride_id: taxiRideId,
    p_country_code: countryCode,
    p_city: null,
  });
}

export async function recordTaxiPreferenceStats(
  supabase: SupabaseClient,
  ride: Record<string, unknown>,
): Promise<void> {
  const prefs = (ride.client_preferences ?? {}) as Record<string, boolean>;
  const ambiance = String(ride.ambiance_preference ?? "none");
  const fuel = String(ride.assigned_fuel_type ?? ride.is_green_vehicle ? "electric" : "");
  const country = ride.country_code ? String(ride.country_code) : null;
  const statDate = new Date().toISOString().slice(0, 10);

  const patch: Record<string, number> = { rides_total: 1 };
  if (fuel === "electric") patch.rides_electric = 1;
  if (fuel === "hybrid" || fuel === "plug_in_hybrid") patch.rides_hybrid = 1;
  if (prefs.child_seat_required) patch.rides_child_seat = 1;
  if (String(ride.vehicle_class ?? "") === "wheelchair_accessible") patch.rides_wheelchair = 1;
  if (prefs.large_luggage) patch.rides_large_luggage = 1;
  if (prefs.non_smoking_driver) patch.rides_non_smoking = 1;
  if (ambiance === "quiet") patch.ambiance_quiet = 1;
  if (ambiance === "music") patch.ambiance_music = 1;
  if (ambiance === "conversation") patch.ambiance_conversation = 1;

  const { data: existing } = await supabase
    .from("taxi_preference_stats")
    .select("*")
    .eq("stat_date", statDate)
    .eq("country_code", country)
    .is("city", null)
    .maybeSingle();

  if (existing?.id) {
    const update: Record<string, unknown> = {};
    for (const [key, inc] of Object.entries(patch)) {
      update[key] = Number(existing[key] ?? 0) + inc;
    }
    await supabase.from("taxi_preference_stats").update(update).eq("id", existing.id);
    return;
  }

  await supabase.from("taxi_preference_stats").insert({
    stat_date: statDate,
    country_code: country,
    city: null,
    ...patch,
  });
}
