import { createDriverDeliveryRequestOffers } from "@/lib/createDriverDeliveryRequestOffers";

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

function isDispatchableDeliveryRequest(request: {
  payment_status?: unknown;
  status?: unknown;
  driver_id?: unknown;
}) {
  if (request.driver_id) return false;
  if (normalize(request.payment_status) !== "paid") return false;

  const status = normalize(request.status);
  return (
    status === "pending" ||
    status === "paid_pending" ||
    status === "processing_pending"
  );
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

export type RunDeliveryRequestDispatchResult = {
  ok: boolean;
  deliveryRequestId: string;
  wave: number;
  notified: number;
  candidates: number;
  offerStats?: { created: number; refreshed: number; skipped: number };
  message?: string;
  error?: string;
};

export async function runDeliveryRequestDispatch(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  deliveryRequestId: string;
  wave?: number;
  locationFreshMinutes?: number;
}): Promise<RunDeliveryRequestDispatchResult> {
  const {
    supabase,
    deliveryRequestId,
    wave: requestedWave = 1,
    locationFreshMinutes = 20,
  } = params;

  const wave = Math.min(Math.max(requestedWave, 1), 3);
  const waveConfig = DISPATCH_WAVES[wave] ?? DISPATCH_WAVES[1];
  const maxDrivers = waveConfig.maxDrivers;
  const maxMiles = waveConfig.maxMiles;

  const { data: request, error: requestError } = await supabase
    .from("delivery_requests")
    .select(
      "id,payment_status,status,driver_id,pickup_lat,pickup_lng,pickup_address,dropoff_address,delivery_fee,driver_delivery_payout,total,eta_minutes,created_by,client_user_id"
    )
    .eq("id", deliveryRequestId)
    .maybeSingle();

  if (requestError) {
    return {
      ok: false,
      deliveryRequestId,
      wave,
      notified: 0,
      candidates: 0,
      error: requestError.message,
    };
  }

  if (!request) {
    return {
      ok: false,
      deliveryRequestId,
      wave,
      notified: 0,
      candidates: 0,
      error: "Delivery request not found",
    };
  }

  if (!isDispatchableDeliveryRequest(request)) {
    return {
      ok: true,
      deliveryRequestId,
      wave,
      notified: 0,
      candidates: 0,
      message: "Delivery request is not dispatchable",
    };
  }

  const pickupLat = toNumber(request.pickup_lat);
  const pickupLng = toNumber(request.pickup_lng);

  if (pickupLat == null || pickupLng == null) {
    return {
      ok: false,
      deliveryRequestId,
      wave,
      notified: 0,
      candidates: 0,
      error: "Delivery request missing pickup coordinates",
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
      deliveryRequestId,
      wave,
      notified: 0,
      candidates: 0,
      error: locError.message,
    };
  }

  const driverIds = Array.from(
    new Set((locations ?? []).map((r: { driver_id: string }) => String(r.driver_id)).filter(Boolean))
  );

  if (driverIds.length === 0) {
    return {
      ok: true,
      deliveryRequestId,
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
    .eq("is_online", true);

  if (profilesError) {
    return {
      ok: false,
      deliveryRequestId,
      wave,
      notified: 0,
      candidates: 0,
      error: profilesError.message,
    };
  }

  const profileByUserId = new Map<string, { user_id: string }>();
  for (const p of profiles ?? []) {
    profileByUserId.set(String((p as { user_id: string }).user_id), p as { user_id: string });
  }

  const candidates = (locations ?? [])
    .map((loc: { driver_id: string; lat: unknown; lng: unknown }) => {
      const driverId = String(loc.driver_id);
      if (!profileByUserId.has(driverId)) return null;

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
    .slice(0, maxDrivers) as { driverId: string; distanceMiles: number }[];

  if (candidates.length === 0) {
    return {
      ok: true,
      deliveryRequestId,
      wave,
      notified: 0,
      candidates: 0,
      message: "No nearby online drivers available",
    };
  }

  const selectedDriverIds = candidates.map((c) => c.driverId);

  const { data: tokens, error: tokensError } = await supabase
    .from("user_push_tokens")
    .select("user_id,expo_push_token,role")
    .in("user_id", selectedDriverIds)
    .eq("role", "driver");

  if (tokensError) {
    return {
      ok: false,
      deliveryRequestId,
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

  const payout =
    toNumber(request.driver_delivery_payout) ??
    toNumber(request.delivery_fee) ??
    toNumber(request.total);

  const messages = uniqueTokens.map(
    (tokenRow: { expo_push_token: string; user_id: string }) => ({
      to: tokenRow.expo_push_token,
      sound: "default",
      title: "Nouvelle livraison disponible 🚗",
      body: payout
        ? `Demande proche • Gain estimé ${payout.toFixed(2)} USD`
        : "Une demande de livraison proche est disponible.",
      data: {
        type: "delivery_request_dispatch",
        deliveryRequestId: request.id,
        wave,
        screen: "DriverTabs",
      },
      priority: "high",
    })
  );

  const pushResult = await sendExpoPush(messages);

  const offerStats = await createDriverDeliveryRequestOffers({
    supabase,
    deliveryRequest: request,
    candidates,
    wave,
  });

  return {
    ok: true,
    deliveryRequestId,
    wave,
    notified: messages.length,
    candidates: candidates.length,
    offerStats,
    message:
      messages.length > 0 ? "Dispatch sent" : "Offers created without push tokens",
  };
}
