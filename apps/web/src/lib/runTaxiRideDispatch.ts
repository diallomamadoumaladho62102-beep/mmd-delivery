import { createTaxiOffers, sortCandidatesForElectricPreference } from "@/lib/createTaxiOffers";
import { logTaxiEventServer } from "@/lib/taxiEvents";
import { TAXI_FAVORITE_DISPATCH_TIMEOUT_SECONDS } from "@/lib/taxiPremiumDispatch";
import { resolvePushSoundForPlatform, DRIVER_MISSION_PUSH_CHANNEL } from "@/lib/mmdPushSounds";
import { isElectricSearchActive } from "@/lib/taxiCategoryMatching";
import { maybeAdvanceTaxiPreferenceStage, initializeTaxiRidePreferenceDispatch } from "@/lib/taxiPreferenceDispatch";
import {
  maskExpoToken,
  sendExpoPushWithAudit,
  type ExpoTicketRow,
} from "@/lib/expoPushAudit";
import { filterTaxiCandidatesByCapacity } from "@/lib/driverMissionCapacity";

const MAX_DISPATCH_MILES = 15;

const DISPATCH_WAVES: Record<number, { maxDrivers: number; maxMiles: number }> = {
  0: { maxDrivers: 1, maxMiles: MAX_DISPATCH_MILES },
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

async function insertTaxiDispatchLog(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  row: Record<string, unknown>,
) {
  const { error } = await supabase.from("notification_logs").insert(row);
  if (error) {
    console.log(
      "[runTaxiRideDispatch] notification_logs insert failed:",
      error.message,
    );
  }
}

async function sendTaxiOfferPushes(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  taxiRideId: string;
  wave: number;
  messages: Record<string, unknown>[];
  tokenRows: Array<{
    user_id: string;
    expo_push_token: string;
    platform?: string | null;
  }>;
  payoutDollars: string | null;
  distanceByDriver: Map<string, number>;
}): Promise<{ notified: number; tickets: ExpoTicketRow[] }> {
  if (params.messages.length === 0) {
    return { notified: 0, tickets: [] };
  }

  const pushAudit = await sendExpoPushWithAudit(params.messages, {
    receiptWaitMs: 1500,
  });
  const nowIso = new Date().toISOString();
  const dedupBase = `taxi_offer_dispatch:${params.taxiRideId}:w${params.wave}`;

  for (let i = 0; i < params.tokenRows.length; i += 1) {
    const tokenRow = params.tokenRows[i];
    const ticket = pushAudit.tickets[i] ?? null;
    const ticketId = ticket?.id ? String(ticket.id) : null;
    const receipt = ticketId ? pushAudit.receipts[ticketId] ?? null : null;
    const ticketFailed = String(ticket?.status ?? "") === "error";
    const receiptFailed = String(receipt?.status ?? "") === "error";
    const status =
      !pushAudit.ok || ticketFailed || receiptFailed ? "failed" : "sent";

    await insertTaxiDispatchLog(params.supabase, {
      user_id: tokenRow.user_id,
      role: "driver",
      title: "Nouvelle course taxi disponible 🚕",
      body: params.payoutDollars
        ? `Course proche • Gain estimé ${params.payoutDollars} USD`
        : "Une course taxi proche est disponible.",
      data: {
        type: "taxi_offer_dispatch",
        taxi_ride_id: params.taxiRideId,
        wave: params.wave,
        distance_miles: params.distanceByDriver.get(tokenRow.user_id) ?? null,
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
    ? params.tokenRows.filter((_, i) => {
        const t = pushAudit.tickets[i];
        return String(t?.status ?? "ok") !== "error";
      }).length
    : 0;

  return { notified, tickets: pushAudit.tickets };
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

  const wave = Math.min(Math.max(requestedWave, 0), 3);
  const waveConfig = DISPATCH_WAVES[wave] ?? DISPATCH_WAVES[1];
  const maxDrivers = waveConfig.maxDrivers;
  const maxMiles = waveConfig.maxMiles;

  const { data: ride, error: rideError } = await supabase
    .from("taxi_rides")
    .select(
      "id,payment_status,status,driver_id,pickup_lat,pickup_lng,pickup_address,pickup_city,dropoff_address,driver_payout_cents,total_cents,vehicle_class,dispatch_wave,client_user_id,preferred_driver_id,favorite_dispatch_expires_at,premium_driver_only,is_shared_ride,shared_ride_id,prefer_electric_or_hybrid,electric_search_until,electric_search_expired,country_code,preferences_stage_until,preferences_dispatch_stage,client_preferences,ambiance_preference"
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

  // supabase-js rpc() returns a Thenable/builder without .catch — await + try/catch.
  try {
    await supabase.rpc("expire_taxi_electric_search_windows");
  } catch {
    // best-effort cleanup; never block dispatch
  }

  if (!ride.preferences_stage_until) {
    await initializeTaxiRidePreferenceDispatch(
      supabase,
      taxiRideId,
      ride.country_code ? String(ride.country_code) : null,
      ride.pickup_city ? String(ride.pickup_city) : null,
    );
  }

  await maybeAdvanceTaxiPreferenceStage(supabase, taxiRideId);

  const premiumDriverOnly = ride.premium_driver_only === true;

  const oldStatus = String(ride.status ?? "");
  const nowIso = new Date().toISOString();

  if (wave === 0) {
    const preferredDriverId = String(ride.preferred_driver_id ?? "").trim();
    if (!preferredDriverId) {
      return {
        ok: true,
        taxiRideId,
        wave,
        notified: 0,
        candidates: 0,
        message: "No preferred driver on ride",
      };
    }

    const favoriteExpiresAt = new Date(
      Date.now() + TAXI_FAVORITE_DISPATCH_TIMEOUT_SECONDS * 1000
    ).toISOString();

    const { data: locked, error: lockError } = await supabase
      .from("taxi_rides")
      .update({
        status: "dispatching",
        dispatch_wave: 0,
        favorite_dispatch_expires_at: favoriteExpiresAt,
        updated_at: nowIso,
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
        message: "Favorite dispatch already started or ride unavailable",
      };
    }

    await logTaxiEventServer(supabase, {
      rideId: taxiRideId,
      eventType: "dispatch_started",
      oldStatus,
      newStatus: "dispatching",
      triggeredRole: "system",
      description: "Taxi favorite-driver wave 0 started",
      metadata: {
        wave: 0,
        preferred_driver_id: preferredDriverId,
        expires_at: favoriteExpiresAt,
      },
    });

    const { data: eligible, error: eligibleError } = await supabase.rpc(
      "is_taxi_driver_eligible_for_ride",
      {
        p_user_id: preferredDriverId,
        p_taxi_ride_id: taxiRideId,
      }
    );

    if (eligibleError || eligible !== true) {
      return {
        ok: true,
        taxiRideId,
        wave,
        notified: 0,
        candidates: 0,
        message: "Preferred driver not eligible for favorite dispatch",
      };
    }

    const { data: capacityOk } = await supabase.rpc(
      "taxi_driver_can_receive_offer",
      { p_user_id: preferredDriverId },
    );
    if (capacityOk !== true) {
      return {
        ok: true,
        taxiRideId,
        wave,
        notified: 0,
        candidates: 0,
        message: "Preferred driver at taxi capacity",
      };
    }

    const pickupLat = toNumber(ride.pickup_lat);
    const pickupLng = toNumber(ride.pickup_lng);
    let distanceMiles = 0;

    if (pickupLat != null && pickupLng != null) {
      const { data: loc } = await supabase
        .from("driver_locations")
        .select("lat,lng")
        .eq("driver_id", preferredDriverId)
        .maybeSingle();

      const lat = toNumber(loc?.lat);
      const lng = toNumber(loc?.lng);
      if (lat != null && lng != null) {
        distanceMiles = milesBetween(pickupLat, pickupLng, lat, lng);
      }
    }

    const candidates = [
      {
        driverId: preferredDriverId,
        distanceMiles: Math.round(distanceMiles * 100) / 100,
      },
    ];

    const offerStats = await createTaxiOffers({
      supabase,
      taxiRideId,
      vehicleClass: String(ride.vehicle_class ?? "standard"),
      candidates,
      wave: 0,
      isFavoriteDispatch: true,
      premiumDriverOnly,
    });

    const { data: tokens, error: tokensError } = await supabase
      .from("user_push_tokens")
      .select("user_id,expo_push_token,role,platform")
      .eq("user_id", preferredDriverId)
      .eq("role", "driver");

    if (tokensError) {
      return {
        ok: false,
        taxiRideId,
        wave,
        notified: 0,
        candidates: 1,
        error: tokensError.message,
      };
    }

    const payoutCents = toNumber(ride.driver_payout_cents);
    const payoutDollars =
      payoutCents != null ? (payoutCents / 100).toFixed(2) : null;

    const tokenRows = (tokens ?? []).filter((t: { expo_push_token?: string }) =>
      String(t.expo_push_token ?? "").startsWith("ExponentPushToken[")
    ) as Array<{
      user_id: string;
      expo_push_token: string;
      platform?: string | null;
    }>;

    const messages = tokenRows.map((tokenRow) => ({
      to: tokenRow.expo_push_token,
      sound: resolvePushSoundForPlatform("taxi_offer_dispatch", tokenRow.platform),
      channelId: DRIVER_MISSION_PUSH_CHANNEL,
      title: "Course favori client ⭐",
      body: payoutDollars
        ? `Un client vous a choisi • Gain estimé ${payoutDollars} USD`
        : "Un client vous a choisi pour sa course taxi.",
      data: {
        type: "taxi_offer_dispatch",
        taxiRideId: ride.id,
        wave: 0,
        isFavoriteDispatch: true,
        screen: "DriverTabs",
      },
      priority: "high",
    }));

    const pushResult = await sendTaxiOfferPushes({
      supabase,
      taxiRideId,
      wave: 0,
      messages,
      tokenRows,
      payoutDollars,
      distanceByDriver: new Map([[preferredDriverId, distanceMiles]]),
    });

    await logTaxiEventServer(supabase, {
      rideId: taxiRideId,
      eventType: "dispatch_wave_sent",
      oldStatus: "dispatching",
      newStatus: "dispatching",
      triggeredRole: "system",
      description: "Taxi favorite-driver wave 0 sent",
      metadata: {
        wave: 0,
        preferred_driver_id: preferredDriverId,
        notified: pushResult.notified,
        offerStats,
        expo_tickets: pushResult.tickets.length,
      },
    });

    return {
      ok: true,
      taxiRideId,
      wave,
      notified: pushResult.notified,
      candidates: 1,
      offerStats,
      message:
        pushResult.notified > 0
          ? "Favorite driver dispatch sent"
          : "Favorite offer created without push tokens",
    };
  }

  if (wave === 1) {
    const wave1StartedAt = nowIso;

    let lockedId: string | null = null;

    const { data: paidLock, error: paidLockError } = await supabase
      .from("taxi_rides")
      .update({
        status: "dispatching",
        dispatch_wave: 1,
        favorite_dispatch_expires_at: null,
        updated_at: wave1StartedAt,
      })
      .eq("id", taxiRideId)
      .eq("status", "paid")
      .eq("dispatch_wave", 0)
      .is("driver_id", null)
      .select("id")
      .maybeSingle();

    if (paidLockError) {
      return {
        ok: false,
        taxiRideId,
        wave,
        notified: 0,
        candidates: 0,
        error: paidLockError.message,
      };
    }

    lockedId = paidLock?.id ? String(paidLock.id) : null;

    if (!lockedId) {
      const { data: fallbackLock, error: fallbackLockError } = await supabase
        .from("taxi_rides")
        .update({
          status: "dispatching",
          dispatch_wave: 1,
          favorite_dispatch_expires_at: null,
          updated_at: wave1StartedAt,
        })
        .eq("id", taxiRideId)
        .eq("status", "dispatching")
        .eq("dispatch_wave", 0)
        .is("driver_id", null)
        .lte("favorite_dispatch_expires_at", wave1StartedAt)
        .select("id")
        .maybeSingle();

      if (fallbackLockError) {
        return {
          ok: false,
          taxiRideId,
          wave,
          notified: 0,
          candidates: 0,
          error: fallbackLockError.message,
        };
      }

      lockedId = fallbackLock?.id ? String(fallbackLock.id) : null;
    }

    if (!lockedId) {
      return {
        ok: true,
        taxiRideId,
        wave,
        notified: 0,
        candidates: 0,
        message: "Wave 1 dispatch already started",
      };
    }

    await supabase
      .from("taxi_offers")
      .update({ status: "expired", updated_at: wave1StartedAt })
      .eq("taxi_ride_id", taxiRideId)
      .eq("wave", 0)
      .eq("status", "pending");

    await logTaxiEventServer(supabase, {
      rideId: taxiRideId,
      eventType: "dispatch_started",
      oldStatus,
      newStatus: "dispatching",
      triggeredRole: "system",
      description: "Taxi dispatch wave 1 started",
      metadata: { wave: 1, favorite_fallback: oldStatus === "dispatching" },
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

  let rankedCandidates = (locations ?? [])
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
    .filter(Boolean) as { driverId: string; distanceMiles: number }[];

  const electricActive = isElectricSearchActive({
    preferElectricOrHybrid: ride.prefer_electric_or_hybrid === true,
    electricSearchExpired: ride.electric_search_expired === true,
    electricSearchUntil: ride.electric_search_until
      ? String(ride.electric_search_until)
      : null,
  });

  if (electricActive && rankedCandidates.length > 0) {
    const fuelByDriver = new Map<string, string | null>();
    for (const candidate of rankedCandidates) {
      const { data: vehicleId } = await supabase.rpc("get_driver_active_vehicle_id", {
        p_user_id: candidate.driverId,
      });
      if (!vehicleId) {
        fuelByDriver.set(candidate.driverId, null);
        continue;
      }
      const { data: vehicleRow } = await supabase
        .from("driver_vehicles")
        .select("fuel_type")
        .eq("id", vehicleId)
        .maybeSingle();
      fuelByDriver.set(
        candidate.driverId,
        vehicleRow?.fuel_type ? String(vehicleRow.fuel_type) : null,
      );
    }
    rankedCandidates = sortCandidatesForElectricPreference(rankedCandidates, fuelByDriver);
  } else {
    rankedCandidates.sort((a, b) => a.distanceMiles - b.distanceMiles);
  }

  const capacityFiltered = await filterTaxiCandidatesByCapacity({
    supabase,
    candidates: rankedCandidates,
  });
  const candidates = capacityFiltered.eligible.slice(0, maxDrivers);

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
    premiumDriverOnly,
  });

  const selectedDriverIds = candidates.map((c) => c.driverId);

  const { data: tokens, error: tokensError } = await supabase
    .from("user_push_tokens")
    .select("user_id,expo_push_token,role,platform")
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
        .map(
          (t: {
            expo_push_token: string;
            user_id: string;
            platform?: string | null;
          }) => [String(t.expo_push_token), t],
        ),
    ).values(),
  ) as Array<{
    user_id: string;
    expo_push_token: string;
    platform?: string | null;
  }>;

  const payoutCents = toNumber(ride.driver_payout_cents);
  const payoutDollars =
    payoutCents != null ? (payoutCents / 100).toFixed(2) : null;

  const messages = uniqueTokens.map((tokenRow) => ({
    to: tokenRow.expo_push_token,
    sound: resolvePushSoundForPlatform("taxi_offer_dispatch", tokenRow.platform),
    channelId: DRIVER_MISSION_PUSH_CHANNEL,
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
  }));

  const distanceByDriver = new Map(
    candidates.map((c) => [c.driverId, c.distanceMiles] as const),
  );

  const pushResult = await sendTaxiOfferPushes({
    supabase,
    taxiRideId,
    wave,
    messages,
    tokenRows: uniqueTokens,
    payoutDollars,
    distanceByDriver,
  });

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
      notified: pushResult.notified,
      offerStats,
      expo_tickets: pushResult.tickets.length,
    },
  });

  return {
    ok: true,
    taxiRideId,
    wave,
    notified: pushResult.notified,
    candidates: candidates.length,
    offerStats,
    message:
      pushResult.notified > 0
        ? "Taxi dispatch sent"
        : "Offers created without push tokens",
  };
}
