import { createTaxiOffers } from "@/lib/createTaxiOffers";
import { logTaxiEventServer } from "@/lib/taxiEvents";

const MAX_DISPATCH_MILES = 5;

const DISPATCH_WAVES: Record<number, { maxDrivers: number; maxMiles: number }> = {
  1: { maxDrivers: 3, maxMiles: MAX_DISPATCH_MILES },
  2: { maxDrivers: 6, maxMiles: MAX_DISPATCH_MILES },
  3: { maxDrivers: 10, maxMiles: MAX_DISPATCH_MILES },
};

function toNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function isDispatchableTaxiRide(ride: {
  payment_status?: unknown;
  status?: unknown;
  driver_id?: unknown;
}) {
  if (ride.driver_id) return false;
  if (normalize(ride.payment_status) !== "paid") return false;

  const status = normalize(ride.status);
  return status === "paid" || status === "dispatching";
}

function milesBetween(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function sendExpoPush(messages: Record<string, unknown>[]) {
  if (messages.length === 0) return { ok: true, tickets: [] };

  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });

  const out = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(out?.errors?.[0]?.message || `Expo push failed ${res.status}`);
  }

  return out;
}

export type RunTaxiRideDispatchResult = {
  ok: boolean;
  taxiRideId: string;
  wave: number;
  notified: number;
  candidates: number;
  offerStats?: { created: number; refreshed: number; skipped: number };
  message?: string;
  error?: string;
};

export async function runTaxiRideDispatch(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  taxiRideId: string;
  wave?: number;
  locationFreshMinutes?: number;
}): Promise<RunTaxiRideDispatchResult> {
  const {
    supabase,
    taxiRideId,
    wave: requestedWave = 1,
    locationFreshMinutes = 20,
  } = params;

  const wave = Math.min(Math.max(requestedWave, 1), 3);
  const waveConfig = DISPATCH_WAVES[wave] ?? DISPATCH_WAVES[1];
  const maxDrivers = waveConfig.maxDrivers;
  const maxMiles = waveConfig.maxMiles;

  const { data: ride, error: rideError } = await supabase
    .from("taxi_rides")
    .select(
      "id,payment_status,status,driver_id,pickup_lat,pickup_lng,pickup_address,dropoff_address,driver_payout_cents,total_cents,vehicle_class,dispatch_wave,client_user_id"
    )
    .eq("id", taxiRideId)
    .maybeSingle();

  if (rideError) {
    return {
      ok: false,
      taxiRideId,
      wave,
      notified: 0,
      candidates: 0,
      error: rideError.message,
    };
  }

  if (!ride) {
    return {
      ok: false,
      taxiRideId,
      wave,
      notified: 0,
      candidates: 0,
      error: "Taxi ride not found",
    };
  }

  if (!isDispatchableTaxiRide(ride)) {
    return {
      ok: true,
      taxiRideId,
      wave,
      notified: 0,
      candidates: 0,
      message: "Taxi ride is not dispatchable",
    };
  }

  const oldStatus = String(ride.status ?? "");

  if (wave === 1) {
    const wave1StartedAt = new Date().toISOString();
    const { data: locked, error: lockError } = await supabase
      .from("taxi_rides")
      .update({
        status: "dispatching",
        dispatch_wave: 1,
        updated_at: wave1StartedAt,
      })
      .eq("id", taxiRideId)
      .eq("status", "paid")
      .eq("dispatch_wave", 0)
      .is("driver_id", null)
      .select("id")
      .maybeSingle();

    if (lockError) {
      return {
        ok: false,
        taxiRideId,
        wave,
        notified: 0,
        candidates: 0,
        error: lockError.message,
      };
    }

    if (!locked?.id) {
      return {
        ok: true,
        taxiRideId,
        wave,
        notified: 0,
        candidates: 0,
        message: "Wave 1 dispatch already started",
      };
    }

    await logTaxiEventServer(supabase, {
      rideId: taxiRideId,
      eventType: "dispatch_started",
      oldStatus,
      newStatus: "dispatching",
      triggeredRole: "system",
      description: "Taxi dispatch wave 1 started",
      metadata: { wave: 1 },
    });
  } else {
    await supabase
      .from("taxi_rides")
      .update({ dispatch_wave: wave, updated_at: new Date().toISOString() })
      .eq("id", taxiRideId)
      .eq("status", "dispatching")
      .is("driver_id", null);
  }

  const pickupLat = toNumber(ride.pickup_lat);
  const pickupLng = toNumber(ride.pickup_lng);

  if (pickupLat == null || pickupLng == null) {
    return {
      ok: false,
      taxiRideId,
      wave,
      notified: 0,
      candidates: 0,
      error: "Taxi ride missing pickup coordinates",
    };
  }

  const freshSince = new Date(
    Date.now() - locationFreshMinutes * 60 * 1000
  ).toISOString();

  const { data: locations, error: locError } = await supabase
    .from("driver_locations")
    .select("driver_id,lat,lng,updated_at")
    .gte("updated_at", freshSince);

  if (locError) {
    return {
      ok: false,
      taxiRideId,
      wave,
      notified: 0,
      candidates: 0,
      error: locError.message,
    };
  }

  const driverIds = Array.from(
    new Set(
      (locations ?? [])
        .map((r: { driver_id: string }) => String(r.driver_id))
        .filter(Boolean)
    )
  );

  if (driverIds.length === 0) {
    return {
      ok: true,
      taxiRideId,
      wave,
      notified: 0,
      candidates: 0,
      message: "No fresh driver locations found",
    };
  }

  const { data: profiles, error: profilesError } = await supabase
    .from("driver_profiles")
    .select("user_id,is_online,status")
    .in("user_id", driverIds)
    .eq("is_online", true)
    .eq("status", "approved");

  if (profilesError) {
    return {
      ok: false,
      taxiRideId,
      wave,
      notified: 0,
      candidates: 0,
      error: profilesError.message,
    };
  }

  const { data: taxiFeatures, error: taxiFeaturesError } = await supabase
    .from("taxi_driver_features")
    .select("user_id")
    .in("user_id", driverIds)
    .eq("taxi_enabled", true);

  if (taxiFeaturesError) {
    return {
      ok: false,
      taxiRideId,
      wave,
      notified: 0,
      candidates: 0,
      error: taxiFeaturesError.message,
    };
  }

  const profileByUserId = new Map<string, { user_id: string }>();
  for (const p of profiles ?? []) {
    profileByUserId.set(String((p as { user_id: string }).user_id), p as { user_id: string });
  }

  const taxiEnabledIds = new Set(
    (taxiFeatures ?? []).map((f: { user_id: string }) => String(f.user_id))
  );

  const candidates = (locations ?? [])
    .map((loc: { driver_id: string; lat: unknown; lng: unknown }) => {
      const driverId = String(loc.driver_id);
      if (!profileByUserId.has(driverId) || !taxiEnabledIds.has(driverId)) {
        return null;
      }

      const lat = toNumber(loc.lat);
      const lng = toNumber(loc.lng);
      if (lat == null || lng == null) return null;

      const miles = milesBetween(pickupLat, pickupLng, lat, lng);
      if (miles > maxMiles) return null;

      return {
        driverId,
        distanceMiles: Math.round(miles * 100) / 100,
      };
    })
    .filter(Boolean)
    .sort(
      (a: { distanceMiles: number }, b: { distanceMiles: number }) =>
        a.distanceMiles - b.distanceMiles
    )
    .slice(0, maxDrivers) as { driverId: string; distanceMiles: number }[];

  if (candidates.length === 0) {
    return {
      ok: true,
      taxiRideId,
      wave,
      notified: 0,
      candidates: 0,
      message: "No nearby eligible taxi drivers available",
    };
  }

  const offerStats = await createTaxiOffers({
    supabase,
    taxiRideId,
    vehicleClass: String(ride.vehicle_class ?? "standard"),
    candidates,
    wave,
  });

  const selectedDriverIds = candidates.map((c) => c.driverId);

  const { data: tokens, error: tokensError } = await supabase
    .from("user_push_tokens")
    .select("user_id,expo_push_token,role")
    .in("user_id", selectedDriverIds)
    .eq("role", "driver");

  if (tokensError) {
    return {
      ok: false,
      taxiRideId,
      wave,
      notified: 0,
      candidates: candidates.length,
      error: tokensError.message,
    };
  }

  const uniqueTokens = Array.from(
    new Map(
      (tokens ?? [])
        .filter((t: { expo_push_token?: string }) =>
          String(t.expo_push_token ?? "").startsWith("ExponentPushToken[")
        )
        .map((t: { expo_push_token: string; user_id: string }) => [
          String(t.expo_push_token),
          t,
        ])
    ).values()
  );

  const payoutCents = toNumber(ride.driver_payout_cents);
  const payoutDollars =
    payoutCents != null ? (payoutCents / 100).toFixed(2) : null;

  const messages = uniqueTokens.map(
    (tokenRow: { expo_push_token: string; user_id: string }) => ({
      to: tokenRow.expo_push_token,
      sound: "default",
      title: "Nouvelle course taxi disponible 🚕",
      body: payoutDollars
        ? `Course proche • Gain estimé ${payoutDollars} USD`
        : "Une course taxi proche est disponible.",
      data: {
        type: "taxi_offer_dispatch",
        taxiRideId: ride.id,
        wave,
        screen: "DriverTabs",
      },
      priority: "high",
    })
  );

  if (messages.length > 0) {
    await sendExpoPush(messages);
  }

  await logTaxiEventServer(supabase, {
    rideId: taxiRideId,
    eventType: "dispatch_wave_sent",
    oldStatus: "dispatching",
    newStatus: "dispatching",
    triggeredRole: "system",
    description: `Taxi dispatch wave ${wave} sent`,
    metadata: {
      wave,
      candidates: candidates.length,
      notified: messages.length,
      offerStats,
    },
  });

  return {
    ok: true,
    taxiRideId,
    wave,
    notified: messages.length,
    candidates: candidates.length,
    offerStats,
    message:
      messages.length > 0 ? "Taxi dispatch sent" : "Offers created without push tokens",
  };
}
