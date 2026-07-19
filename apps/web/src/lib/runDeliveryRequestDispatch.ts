import { createDriverDeliveryRequestOffers } from "@/lib/createDriverDeliveryRequestOffers";
import {
  DELIVERY_REQUEST_DISPATCH_WAVES,
  DELIVERY_REQUEST_MAX_DISPATCH_MILES,
} from "@/lib/deliveryDispatchConstants";
import { filterDriverIdsByServicePreference } from "@/lib/driverServiceDispatchFilter";
import {
  maskExpoToken,
  sendExpoPushWithAudit,
  type ExpoReceiptRow,
  type ExpoTicketRow,
} from "@/lib/expoPushAudit";
import {
  DRIVER_MISSION_PUSH_CHANNEL,
  resolvePushSoundForPlatform,
} from "@/lib/mmdPushSounds";

const DISPATCH_WAVES = DELIVERY_REQUEST_DISPATCH_WAVES;

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

async function insertDispatchLog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  row: Record<string, unknown>,
) {
  const { error } = await supabase.from("notification_logs").insert(row);
  if (error) {
    console.log(
      "[runDeliveryRequestDispatch] notification_logs insert failed:",
      error.message,
    );
  }
}

export type RunDeliveryRequestDispatchResult = {
  ok: boolean;
  deliveryRequestId: string;
  wave: number;
  notified: number;
  candidates: number;
  maxMiles: number;
  offerStats?: { created: number; refreshed: number; skipped: number };
  expoTickets?: ExpoTicketRow[];
  expoReceipts?: Record<string, ExpoReceiptRow>;
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

  const baseResult = {
    deliveryRequestId,
    wave,
    maxMiles: DELIVERY_REQUEST_MAX_DISPATCH_MILES,
  };

  const { data: request, error: requestError } = await supabase
    .from("delivery_requests")
    .select(
      "id,payment_status,status,driver_id,pickup_lat,pickup_lng,pickup_address,dropoff_address,delivery_fee,driver_delivery_payout,total,eta_minutes,created_by,client_user_id,dispatch_wave_1_started_at",
    )
    .eq("id", deliveryRequestId)
    .maybeSingle();

  if (requestError) {
    return {
      ok: false,
      ...baseResult,
      notified: 0,
      candidates: 0,
      error: requestError.message,
    };
  }

  if (!request) {
    return {
      ok: false,
      ...baseResult,
      notified: 0,
      candidates: 0,
      error: "Delivery request not found",
    };
  }

  if (!isDispatchableDeliveryRequest(request)) {
    // Still stamp wave-1 if paid+pending never locked (audit requirement).
    if (
      wave === 1 &&
      !request.dispatch_wave_1_started_at &&
      normalize(request.payment_status) === "paid"
    ) {
      await supabase
        .from("delivery_requests")
        .update({ dispatch_wave_1_started_at: new Date().toISOString() })
        .eq("id", deliveryRequestId)
        .is("dispatch_wave_1_started_at", null);
    }

    await insertDispatchLog(supabase, {
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
        max_miles: maxMiles,
        notified: 0,
        provider: "expo",
      },
      status: "failed",
      error_message: "not_dispatchable",
      dedup_key: `delivery_request_dispatch:${deliveryRequestId}:wave:${wave}:not_dispatchable`,
      sent_at: null,
    });
    return {
      ok: true,
      ...baseResult,
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
        ...baseResult,
        notified: 0,
        candidates: 0,
        error: lockError.message,
      };
    }

    if (!locked?.id) {
      // Allow re-entry for wave 1 only when no offers were ever created (failed first pass).
      const { count } = await supabase
        .from("delivery_request_driver_offers")
        .select("id", { count: "exact", head: true })
        .eq("delivery_request_id", deliveryRequestId);

      if ((count ?? 0) > 0) {
        return {
          ok: true,
          ...baseResult,
          notified: 0,
          candidates: 0,
          message: "Wave 1 dispatch already started",
        };
      }
      console.log(
        "[runDeliveryRequestDispatch] wave-1 re-entry: locked but zero offers",
        { deliveryRequestId },
      );
    }
  }

  const pickupLat = toNumber(request.pickup_lat);
  const pickupLng = toNumber(request.pickup_lng);

  if (pickupLat == null || pickupLng == null) {
    await insertDispatchLog(supabase, {
      user_id: request.client_user_id ?? request.created_by ?? null,
      role: "driver",
      title: "Delivery dispatch skipped",
      body: "Delivery request missing pickup coordinates",
      data: {
        type: "delivery_request_dispatch",
        delivery_request_id: deliveryRequestId,
        wave,
        reason: "missing_pickup_coordinates",
        max_miles: maxMiles,
        provider: "expo",
      },
      status: "failed",
      error_message: "missing_pickup_coordinates",
      dedup_key: `delivery_request_dispatch:${deliveryRequestId}:wave:${wave}:no_coords`,
      sent_at: null,
    });
    return {
      ok: false,
      ...baseResult,
      notified: 0,
      candidates: 0,
      error: "Delivery request missing pickup coordinates",
    };
  }

  const freshSince = new Date(
    Date.now() - locationFreshMinutes * 60 * 1000,
  ).toISOString();

  const { data: locations, error: locError } = await supabase
    .from("driver_locations")
    .select("driver_id,lat,lng,updated_at")
    .gte("updated_at", freshSince);

  if (locError) {
    return {
      ok: false,
      ...baseResult,
      notified: 0,
      candidates: 0,
      error: locError.message,
    };
  }

  const driverIds = Array.from(
    new Set(
      (locations ?? [])
        .map((r: { driver_id: string }) => String(r.driver_id))
        .filter(Boolean),
    ),
  );

  if (driverIds.length === 0) {
    await insertDispatchLog(supabase, {
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
        max_miles: maxMiles,
        provider: "expo",
      },
      status: "failed",
      error_message: "no_fresh_driver_locations",
      dedup_key: `delivery_request_dispatch:${deliveryRequestId}:wave:${wave}:no_locations`,
      sent_at: null,
    });
    return {
      ok: true,
      ...baseResult,
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
      ...baseResult,
      notified: 0,
      candidates: 0,
      error: profilesError.message,
    };
  }

  const profileByUserId = new Map<string, { user_id: string }>();
  for (const p of profiles ?? []) {
    profileByUserId.set(
      String((p as { user_id: string }).user_id),
      p as { user_id: string },
    );
  }

  const serviceEnabledDriverIds = await filterDriverIdsByServicePreference(
    supabase,
    Array.from(profileByUserId.keys()),
    "package",
  );

  const candidates = (locations ?? [])
    .map((loc: { driver_id: string; lat: unknown; lng: unknown }) => {
      const driverId = String(loc.driver_id);
      if (!profileByUserId.has(driverId) || !serviceEnabledDriverIds.has(driverId)) {
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
      (a, b) =>
        (a as { distanceMiles: number }).distanceMiles -
        (b as { distanceMiles: number }).distanceMiles,
    )
    .slice(0, maxDrivers) as { driverId: string; distanceMiles: number }[];

  if (candidates.length === 0) {
    await insertDispatchLog(supabase, {
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
        max_miles: maxMiles,
        provider: "expo",
      },
      status: "failed",
      error_message: "no_nearby_online_drivers",
      dedup_key: `delivery_request_dispatch:${deliveryRequestId}:wave:${wave}:no_candidates`,
      sent_at: null,
    });
    return {
      ok: true,
      ...baseResult,
      notified: 0,
      candidates: 0,
      message: "No nearby online drivers available",
    };
  }

  // Create offers first so the driver app can ring via Realtime even if push fails.
  const offerStats = await createDriverDeliveryRequestOffers({
    supabase,
    deliveryRequest: request,
    candidates,
    wave,
  });

  const selectedDriverIds = candidates.map((c) => c.driverId);

  const { data: tokens, error: tokensError } = await supabase
    .from("user_push_tokens")
    .select("user_id,expo_push_token,role,platform")
    .in("user_id", selectedDriverIds)
    .eq("role", "driver");

  if (tokensError) {
    await insertDispatchLog(supabase, {
      user_id: selectedDriverIds[0] ?? null,
      role: "driver",
      title: "Delivery dispatch token error",
      body: tokensError.message,
      data: {
        type: "delivery_request_dispatch",
        delivery_request_id: deliveryRequestId,
        wave,
        candidates: candidates.length,
        offerStats,
        provider: "expo",
      },
      status: "failed",
      error_message: tokensError.message,
      dedup_key: `delivery_request_dispatch:${deliveryRequestId}:wave:${wave}:tokens_error`,
      sent_at: null,
    });
    return {
      ok: false,
      ...baseResult,
      notified: 0,
      candidates: candidates.length,
      offerStats,
      error: tokensError.message,
    };
  }

  const uniqueTokens = Array.from(
    new Map(
      (tokens ?? [])
        .filter((t: { expo_push_token?: string }) =>
          String(t.expo_push_token ?? "").startsWith("ExponentPushToken["),
        )
        .map((t: { expo_push_token: string; user_id: string }) => [
          String(t.expo_push_token),
          t,
        ]),
    ).values(),
  ) as Array<{
    expo_push_token: string;
    user_id: string;
    platform?: string | null;
  }>;

  const payout =
    toNumber(request.driver_delivery_payout) ??
    toNumber(request.delivery_fee) ??
    toNumber(request.total);

  const messages = uniqueTokens.map((tokenRow) => ({
    to: tokenRow.expo_push_token,
    sound: resolvePushSoundForPlatform(
      "delivery_request_dispatch",
      tokenRow.platform,
    ),
    channelId: DRIVER_MISSION_PUSH_CHANNEL,
    title: "Nouvelle livraison disponible 🚗",
    body: payout
      ? `Demande proche • Gain estimé ${payout.toFixed(2)} USD`
      : "Une demande de livraison proche est disponible.",
    data: {
      type: "delivery_request_dispatch",
      deliveryRequestId: request.id,
      delivery_request_id: request.id,
      wave,
      screen: "DriverTabs",
    },
    priority: "high" as const,
    _contentAvailable: true,
  }));

  const dedupBase = `delivery_request_dispatch:${deliveryRequestId}:wave:${wave}`;
  const nowIso = new Date().toISOString();

  if (uniqueTokens.length === 0) {
    await insertDispatchLog(supabase, {
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
        offerStats,
        max_miles: maxMiles,
        provider: "expo",
        expo_ticket_id: null,
        expo_receipt: null,
      },
      status: "failed",
      error_message: "no_tokens",
      dedup_key: `${dedupBase}:no_tokens`,
      sent_at: null,
    });

    return {
      ok: true,
      ...baseResult,
      notified: 0,
      candidates: candidates.length,
      offerStats,
      message: "Offers created without push tokens",
    };
  }

  const pushAudit = await sendExpoPushWithAudit(messages, {
    receiptWaitMs: 1500,
  });

  for (let i = 0; i < uniqueTokens.length; i += 1) {
    const tokenRow = uniqueTokens[i];
    const ticket = pushAudit.tickets[i] ?? null;
    const ticketId = ticket?.id ? String(ticket.id) : null;
    const receipt = ticketId ? pushAudit.receipts[ticketId] ?? null : null;
    const ticketFailed = String(ticket?.status ?? "") === "error";
    const receiptFailed = String(receipt?.status ?? "") === "error";
    const status =
      !pushAudit.ok || ticketFailed || receiptFailed ? "failed" : "sent";

    await insertDispatchLog(supabase, {
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
        max_miles: maxMiles,
        distance_miles:
          candidates.find((c) => c.driverId === tokenRow.user_id)
            ?.distanceMiles ?? null,
        provider: "expo",
        expo_token_masked: maskExpoToken(tokenRow.expo_push_token),
        expo_ticket_id: ticketId,
        expo_ticket_status: ticket?.status ?? null,
        expo_ticket: ticket,
        expo_receipt: receipt,
        expo_receipt_status: receipt?.status ?? null,
        platform: tokenRow.platform ?? null,
      },
      status,
      error_message:
        ticket?.message ||
        receipt?.message ||
        pushAudit.error ||
        (status === "failed" ? "push_failed" : null),
      dedup_key: `${dedupBase}:${tokenRow.user_id}:${ticketId ?? i}`,
      sent_at: status === "sent" ? nowIso : null,
    });
  }

  const notified = pushAudit.ok
    ? uniqueTokens.filter((_, i) => {
        const t = pushAudit.tickets[i];
        return String(t?.status ?? "ok") !== "error";
      }).length
    : 0;

  return {
    ok: true,
    ...baseResult,
    notified,
    candidates: candidates.length,
    offerStats,
    expoTickets: pushAudit.tickets,
    expoReceipts: pushAudit.receipts,
    message: pushAudit.ok
      ? "Dispatch sent"
      : `Push failed: ${pushAudit.error ?? "unknown"}`,
  };
}
