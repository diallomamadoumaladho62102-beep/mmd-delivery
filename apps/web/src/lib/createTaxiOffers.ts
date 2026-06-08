import { DRIVER_ORDER_OFFER_TTL_SECONDS } from "@/lib/createDriverOrderOffers";

type DispatchCandidate = {
  driverId: string;
  distanceMiles: number;
};

export async function createTaxiOffers(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  taxiRideId: string;
  vehicleClass: string;
  candidates: DispatchCandidate[];
  wave: number;
}): Promise<{ created: number; refreshed: number; skipped: number }> {
  const { supabase, taxiRideId, vehicleClass, candidates, wave } = params;

  if (candidates.length === 0) {
    return { created: 0, refreshed: 0, skipped: 0 };
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + DRIVER_ORDER_OFFER_TTL_SECONDS * 1000
  ).toISOString();

  let created = 0;
  let refreshed = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const driverId = String(candidate.driverId);
    if (!driverId) {
      skipped += 1;
      continue;
    }

    const { data: eligible, error: eligibleError } = await supabase.rpc(
      "is_taxi_driver_eligible",
      {
        p_user_id: driverId,
        p_vehicle_class: vehicleClass,
      }
    );

    if (eligibleError || eligible !== true) {
      skipped += 1;
      continue;
    }

    const { data: existing, error: existingError } = await supabase
      .from("taxi_offers")
      .select("id,status,expires_at")
      .eq("taxi_ride_id", taxiRideId)
      .eq("driver_id", driverId)
      .eq("wave", wave)
      .eq("status", "pending")
      .gt("expires_at", nowIso)
      .maybeSingle();

    if (existingError) {
      console.log("taxi_offers lookup error:", existingError.message);
      skipped += 1;
      continue;
    }

    const offerRow = {
      taxi_ride_id: taxiRideId,
      driver_id: driverId,
      status: "pending",
      wave,
      distance_miles: candidate.distanceMiles,
      vehicle_class_match: true,
      expires_at: expiresAt,
      updated_at: nowIso,
    };

    if (existing?.id) {
      const { error: updateError } = await supabase
        .from("taxi_offers")
        .update(offerRow)
        .eq("id", existing.id);

      if (updateError) {
        console.log("taxi_offers refresh error:", updateError.message);
        skipped += 1;
      } else {
        refreshed += 1;
      }
      continue;
    }

    await supabase
      .from("taxi_offers")
      .update({ status: "expired", updated_at: nowIso })
      .eq("taxi_ride_id", taxiRideId)
      .eq("driver_id", driverId)
      .eq("status", "pending")
      .lte("expires_at", nowIso);

    const { error: insertError } = await supabase.from("taxi_offers").insert({
      ...offerRow,
      created_at: nowIso,
    });

    if (insertError) {
      if (insertError.code === "23505") {
        const { error: upsertError } = await supabase
          .from("taxi_offers")
          .update(offerRow)
          .eq("taxi_ride_id", taxiRideId)
          .eq("driver_id", driverId)
          .eq("wave", wave);

        if (upsertError) {
          skipped += 1;
        } else {
          refreshed += 1;
        }
      } else {
        console.log("taxi_offers insert error:", insertError.message);
        skipped += 1;
      }
    } else {
      created += 1;
    }
  }

  return { created, refreshed, skipped };
}
