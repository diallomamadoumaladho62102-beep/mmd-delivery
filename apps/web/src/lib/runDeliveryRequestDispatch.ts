import { createDriverDeliveryRequestOffers } from "@/lib/createDriverDeliveryRequestOffers";
import { resolvePushSoundForPlatform, DRIVER_MISSION_PUSH_CHANNEL } from "@/lib/mmdPushSounds";
import { filterDriverIdsByServicePreference } from "@/lib/driverServiceDispatchFilter";

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
    await supabase.from("notification_logs").insert({
      user_id: request.client_user_id ?? request.created_by ?? null,
      role: "driver",
      title: "Delivery dispatch skipped",
      body: "Delivery request is not dispatchable",
      data: {
        type: "delivery_request_dispatch",
        delivery_request_id: deliveryRequestId,
        wave,
        reason: "not_dispatchable",
        payment_status: request.payment_status ?? null,
        status: request.status ?? null,
        has_driver: Boolean(request.driver_id),
        notified: 0,
      },
      status: "failed",
      error_message: "not_dispatchable",
      dedup_key: `delivery_request_dispatch:${deliveryRequestId}:wave:${wave}:not_dispatchable`,
      sent_at: null,
    });
    return {
      ok: true,
      deliveryRequestId,
      wave,
      notified: 0,
      candidates: 0,
      message: "Delivery request is not dispatchable",
    };
  }

  if (wave === 1) {
    const wave1StartedAt = new Date().toISOString();
    const { data: locked, error: lockError } = await supabase
      .from("delivery_requests")
      .update({ dispatch_wave_1_started_at: wave1StartedAt })
      .eq("id", deliveryRequestId)
      .is("dispatch_wave_1_started_at", null)
      .select("id")
      .maybeSingle();

    if (lockError) {
      return {
        ok: false,
        deliveryRequestId,
        wave,
        notified: 0,
        candidates: 0,
        error: lockError.message,
      };
    }

    if (!locked?.id) {
      return {
        ok: true,
        deliveryRequestId,
        wave,
        notified: 0,
        candidates: 0,
        message: "Wave 1 dispatch already started",
      };
    }
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
    await supabase.from("notification_logs").insert({
      user_id: request.client_user_id ?? request.created_by ?? null,
      role: "driver",
      title: "Delivery dispatch skipped",
      body: "No fresh driver locations found",
      data: {
        type: "delivery_request_dispatch",
        delivery_request_id: deliveryRequestId,
        wave,
        reason: "no_fresh_driver_locations",
        candidates: 0,
        notified: 0,
      },
      status: "failed",
      error_message: "no_fresh_driver_locations",
      dedup_key: `delivery_request_dispatch:${deliveryRequestId}:wave:${wave}:no_locations`,
      sent_at: null,
    });
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
    .eq("is_online", true)
    .eq("status", "approved");

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

  const serviceEnabledDriverIds = await filterDriverIdsByServicePreference(
    supabase,
    Array.from(profileByUserId.keys()),
    "package",
  );

  const candidates = (locations ?? [])
    .map((loc: { driver_id: string; lat: unknown; lng: unknown }) => {
      const driverId = String(loc.driver_id);
      if (!profileByUserId.has(driverId) || !serviceEnabledDriverIds.has(driverId)) return null;

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
    await supabase.from("notification_logs").insert({
      user_id: request.client_user_id ?? request.created_by ?? null,
      role: "driver",
      title: "Delivery dispatch skipped",
      body: "No nearby online drivers available",
      data: {
        type: "delivery_request_dispatch",
        delivery_request_id: deliveryRequestId,
        wave,
        reason: "no_nearby_online_drivers",
        candidates: 0,
        notified: 0,
      },
      status: "failed",
      error_message: "no_nearby_online_drivers",
      dedup_key: `delivery_request_dispatch:${deliveryRequestId}:wave:${wave}:no_candidates`,
      sent_at: null,
    });
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
    .select("user_id,expo_push_token,role,platform")
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
    (tokenRow: { expo_push_token: string; user_id: string; platform?: string | null }) => ({
      to: tokenRow.expo_push_token,
      sound: resolvePushSoundForPlatform("delivery_request_dispatch", tokenRow.platform),
      channelId: DRIVER_MISSION_PUSH_CHANNEL,
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

  let pushError: string | null = null;
  try {
    await sendExpoPush(messages);
  } catch (e: unknown) {
    pushError = e instanceof Error ? e.message : String(e);
    console.log("[runDeliveryRequestDispatch] expo push failed:", pushError);
  }

  const offerStats = await createDriverDeliveryRequestOffers({
    supabase,
    deliveryRequest: request,
    candidates,
    wave,
  });

  // Persist audit rows (parity with restaurant push) so Delivery alerts are provable.
  const dedupBase = `delivery_request_dispatch:${deliveryRequestId}:wave:${wave}`;
  if (uniqueTokens.length === 0) {
    await supabase.from("notification_logs").insert({
      user_id: selectedDriverIds[0] ?? request.client_user_id ?? null,
      role: "driver",
      title: "Nouvelle livraison disponible",
      body: "Dispatch sans token push chauffeur.",
      data: {
        type: "delivery_request_dispatch",
        delivery_request_id: deliveryRequestId,
        wave,
        candidates: candidates.length,
        notified: 0,
      },
      status: "failed",
      error_message: pushError ?? "no_tokens",
      dedup_key: `${dedupBase}:no_tokens`,
      sent_at: null,
    });
  } else {
    const nowIso = new Date().toISOString();
    await supabase.from("notification_logs").insert(
      uniqueTokens.map(
        (tokenRow: { expo_push_token: string; user_id: string }) => ({
          user_id: tokenRow.user_id,
          role: "driver",
          title: "Nouvelle livraison disponible",
          body: payout
            ? `Demande proche • Gain estimé ${Number(payout).toFixed(2)} USD`
            : "Une demande de livraison proche est disponible.",
          data: {
            type: "delivery_request_dispatch",
            delivery_request_id: deliveryRequestId,
            wave,
            expo_token_suffix: String(tokenRow.expo_push_token).slice(-8),
          },
          status: pushError ? "failed" : "sent",
          error_message: pushError,
          dedup_key: `${dedupBase}:${tokenRow.user_id}`,
          sent_at: pushError ? null : nowIso,
        }),
      ),
    );
  }

  return {
    ok: true,
    deliveryRequestId,
    wave,
    notified: pushError ? 0 : messages.length,
    candidates: candidates.length,
    offerStats,
    message: pushError
      ? `Push failed: ${pushError}`
      : messages.length > 0
        ? "Dispatch sent"
        : "Offers created without push tokens",
  };
}
