import type { SupabaseClient } from "@supabase/supabase-js";
import { taxiJson } from "@/lib/taxiApi";
import { resolveTaxiMultiStopRoute, ROUTE_UNAVAILABLE } from "@/lib/taxiMapbox";
import { validateRouteClaimsServer } from "@/lib/geoTrust";
import { detectTaxiCountryFromCoords } from "@/lib/taxiCountryDetection";
import { assertPlatformFeature } from "@/lib/platformLaunchControl";
import { runTaxiRideDispatch } from "@/lib/runTaxiRideDispatch";
import {
  GUINEA_COUNTRY_CODE,
  GUINEA_CURRENCY,
  guineaCountryEvidenceAllowsMarket,
  isGuineaMarketEnabled,
  localityLabel,
  resolveGuineaTaxiMarket,
} from "@/lib/markets/guineaMarket";
import {
  buildCashCollectionLedgerRow,
  evaluateCashCollection,
  type CashRideSnapshot,
} from "@/lib/markets/guineaCashPayment";
import { isOrangeMoneyGuineaEnabled } from "@/lib/markets/guineaOrangeMoney";
import {
  calculateGuineaTaxiFareGnf,
  milesToWholeMeters,
  readGuineaTaxiRateCard,
  type GuineaTaxiRateCard,
} from "@/lib/markets/guineaTaxiPricing";
import {
  freezeGuineaStandardSnapshot,
  GUINEA_STANDARD_MAX_DISTANCE_METERS,
  chooseGuineaPoolProposal,
  readGuineaPoolLimits,
  readGuineaStandardCommissionBps,
  resolveGuineaPassengerCount,
  splitGuineaStandardCommission,
} from "@/lib/markets/guineaStandard";

type PointInput = {
  claimedCountryCode?: string | null;
  pickupLat: unknown;
  pickupLng: unknown;
  dropoffLat: unknown;
  dropoffLng: unknown;
  pickupAddress?: string | null;
  dropoffAddress?: string | null;
  stops?: Array<{ lat?: unknown; lng?: unknown; address?: string }> | null;
  sharedRide?: boolean;
  tripMode?: string | null;
  vehicleClass?: string | null;
  paymentMethod?: string | null;
  premiumDriverOnly?: boolean;
  businessAccountId?: string | null;
  promoCode?: string | null;
  rewardId?: string | null;
  clientNotes?: string | null;
  passengerCount?: unknown;
  supabaseAdmin?: SupabaseClient | null;
};

function requestedMethod(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function storedAddress(
  place: string | null | undefined,
  lat: number,
  lng: number,
): string {
  const text = String(place ?? "").trim();
  if (text) return text.slice(0, 240);
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function driverNote(value: unknown): string | null {
  const text = Array.from(String(value ?? ""))
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 32 && code !== 127 && char !== "<" && char !== ">";
    })
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return text || null;
}

function schemaMissing(message: string): boolean {
  return /guinea_standard_|schema cache|does not exist/i.test(message);
}

function wholeSetting(value: unknown): number | null {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) return null;
  return amount;
}

export async function loadCommercialConfig(supabase: SupabaseClient | null | undefined): Promise<
  | { ok: true; card: GuineaTaxiRateCard; bps: number; source: "database" | "environment" }
  | { ok: false; error: "guinea_pricing_not_configured" | "guinea_commission_not_configured" }
> {
  if (supabase) {
    const row = await supabase
      .from("guinea_standard_settings")
      .select("base_fare_gnf,per_km_gnf,per_minute_gnf,minimum_fare_gnf,maximum_fare_gnf,platform_share_bps")
      .eq("id", "GN")
      .maybeSingle();
    if (row.error) {
      if (!schemaMissing(row.error.message)) {
        return { ok: false, error: "guinea_pricing_not_configured" };
      }
    } else if (row.data) {
      const baseFareGnf = wholeSetting(row.data.base_fare_gnf);
      const perKmGnf = wholeSetting(row.data.per_km_gnf);
      const perMinuteGnf = wholeSetting(row.data.per_minute_gnf);
      const minimumFareGnf = wholeSetting(row.data.minimum_fare_gnf);
      const bps = wholeSetting(row.data.platform_share_bps);
      const maximumFareGnf =
        row.data.maximum_fare_gnf == null ? null : wholeSetting(row.data.maximum_fare_gnf);
      if (
        baseFareGnf == null ||
        perKmGnf == null ||
        perMinuteGnf == null ||
        minimumFareGnf == null ||
        (row.data.maximum_fare_gnf != null && maximumFareGnf == null)
      ) {
        return { ok: false, error: "guinea_pricing_not_configured" };
      }
      if (bps == null || bps > 10_000) return { ok: false, error: "guinea_commission_not_configured" };
      return {
        ok: true,
        source: "database",
        bps,
        card: { baseFareGnf, perKmGnf, perMinuteGnf, minimumFareGnf, maximumFareGnf },
      };
    }
  }
  const rates = readGuineaTaxiRateCard();
  if (rates.ok === false) return rates;
  const bps = readGuineaStandardCommissionBps();
  if (bps == null) return { ok: false, error: "guinea_commission_not_configured" };
  return { ok: true, card: rates.card, bps, source: "environment" };
}

function guineaDecision(input: PointInput) {
  return resolveGuineaTaxiMarket({
    enabled: isGuineaMarketEnabled(),
    claimedCountryCode: input.claimedCountryCode,
    pickupLat: input.pickupLat,
    pickupLng: input.pickupLng,
    dropoffLat: input.dropoffLat,
    dropoffLng: input.dropoffLng,
    stops: input.stops,
    sharedRide: input.sharedRide,
    tripMode: input.tripMode,
    vehicleClass: input.vehicleClass,
  });
}

async function routeAndPrice(input: PointInput, card: GuineaTaxiRateCard) {
  const route = await resolveTaxiMultiStopRoute({
    pickupAddress: input.pickupAddress ?? undefined,
    dropoffAddress: input.dropoffAddress ?? undefined,
    pickupLat: Number(input.pickupLat),
    pickupLng: Number(input.pickupLng),
    dropoffLat: Number(input.dropoffLat),
    dropoffLng: Number(input.dropoffLng),
    stops: [],
    includeGeometry: true,
  });

  const detectedCountries = await Promise.all([
    detectTaxiCountryFromCoords(route.pickupLat, route.pickupLng),
    detectTaxiCountryFromCoords(route.dropoffLat, route.dropoffLng),
  ]);
  if (detectedCountries.some((code) => !String(code ?? "").trim())) {
    throw new Error("geographic_validation_unavailable");
  }
  if (!guineaCountryEvidenceAllowsMarket(detectedCountries)) {
    throw new Error("market_mismatch");
  }

  let evidence: {
    pickup: { canonicalAddress: string | null; region: string | null; countryCode: string | null };
    dropoff: { canonicalAddress: string | null; region: string | null; countryCode: string | null };
  } = {
    pickup: {
      canonicalAddress: null,
      region: null,
      countryCode: detectedCountries[0],
    },
    dropoff: {
      canonicalAddress: null,
      region: null,
      countryCode: detectedCountries[1],
    },
  };
  try {
    const validated = await validateRouteClaimsServer({
      pickup: {
        address: route.pickupAddress ?? input.pickupAddress ?? "",
        lat: route.pickupLat,
        lng: route.pickupLng,
      },
      dropoff: {
        address: route.dropoffAddress ?? input.dropoffAddress ?? "",
        lat: route.dropoffLat,
        lng: route.dropoffLng,
      },
      serverDistanceMiles: route.distanceMiles,
      service: "taxi",
    });
    if (
      (validated.pickup.countryCode && validated.pickup.countryCode !== GUINEA_COUNTRY_CODE) ||
      (validated.dropoff.countryCode && validated.dropoff.countryCode !== GUINEA_COUNTRY_CODE)
    ) {
      throw new Error("market_mismatch");
    }
    evidence = {
      pickup: validated.pickup,
      dropoff: validated.dropoff,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "";
    if (message === "market_mismatch") throw error;
    if (!message.startsWith("geographic_validation_unavailable")) {
      throw error;
    }
  }

  const distanceMeters = milesToWholeMeters(route.distanceMiles);
  if (distanceMeters > GUINEA_STANDARD_MAX_DISTANCE_METERS) {
    throw new Error("guinea_standard_distance_exceeded");
  }
  const priced = calculateGuineaTaxiFareGnf({
    distanceMeters,
    durationMinutes: route.durationMinutes,
    card,
  });
  return { route, priced, evidence };
}

function quoteBody(input: {
  locality: string | null;
  fareGnf: number;
  platformFeeGnf: number;
  driverAmountGnf: number;
  distanceMeters: number;
  durationMinutes: number;
  route: {
    pickupLat: number;
    pickupLng: number;
    dropoffLat: number;
    dropoffLng: number;
    pickupAddress: string | null;
    dropoffAddress: string | null;
    distanceMiles: number;
    durationMinutes: number;
    durationSeconds: number;
    routeGeometry?: { type: "LineString"; coordinates: number[][] } | null;
  };
}) {
  const distanceKm = Math.round((input.distanceMeters / 1000) * 10) / 10;
  return {
    ok: true,
    market: "GN",
    country_code: GUINEA_COUNTRY_CODE,
    locality: input.locality,
    city: input.locality,
    currency: GUINEA_CURRENCY,
    payment_method: "cash",
    payment_methods: {
      cash: { enabled: true },
      orange_money: { enabled: isOrangeMoneyGuineaEnabled() },
    },
    quote: {
      market: "GN",
      currency: GUINEA_CURRENCY,
      total_cents: input.fareGnf,
      subtotal_cents: input.fareGnf,
      gross_total_cents: input.fareGnf,
      tax_cents: 0,
      service_fee_cents: 0,
      platform_fee_cents: input.platformFeeGnf,
      driver_payout_cents: input.driverAmountGnf,
      payment_method: "cash",
      charge_path: "guinea_cash",
      distance_km: distanceKm,
      duration_minutes: input.durationMinutes,
    },
    route: {
      pickupLat: input.route.pickupLat,
      pickupLng: input.route.pickupLng,
      dropoffLat: input.route.dropoffLat,
      dropoffLng: input.route.dropoffLng,
      pickupAddress: input.route.pickupAddress,
      dropoffAddress: input.route.dropoffAddress,
      distanceMiles: input.route.distanceMiles,
      durationMinutes: input.route.durationMinutes,
      durationSeconds: input.route.durationSeconds,
      distanceKm,
      stops: [],
      geometry: input.route.routeGeometry ?? null,
    },
  };
}

export async function maybeQuoteGuineaTaxi(input: PointInput) {
  const decision = guineaDecision(input);
  if (decision.kind === "us") return null;
  if (decision.kind === "reject") {
    return taxiJson({ ok: false, error: decision.error }, decision.status);
  }

  const method = requestedMethod(input.paymentMethod);
  if (method === "orange_money" || method === "orange_money_gn") {
    return taxiJson({ ok: false, error: "orange_money_disabled" }, 403);
  }

  const passengers = resolveGuineaPassengerCount(input.passengerCount, decision.vehicle);
  if (passengers.ok === false) {
    return taxiJson({ ok: false, error: passengers.error }, 400);
  }
  const commercial = await loadCommercialConfig(input.supabaseAdmin);
  if (commercial.ok === false) {
    return taxiJson({ ok: false, error: commercial.error }, 503);
  }
  const commissionBps = commercial.bps;

  try {
    const { route, priced, evidence } = await routeAndPrice(input, commercial.card);
    if (priced.ok === false) {
      return taxiJson({ ok: false, error: priced.error }, 400);
    }
    const split = splitGuineaStandardCommission(priced.fareGnf, commissionBps);
    if (!split) {
      return taxiJson({ ok: false, error: "guinea_commission_not_configured" }, 503);
    }
    const locality =
      localityLabel(input.pickupAddress) ??
      localityLabel(evidence.pickup.canonicalAddress);
    return taxiJson(
      quoteBody({
        locality,
        fareGnf: priced.fareGnf,
        platformFeeGnf: split.platformFeeGnf,
        driverAmountGnf: split.driverAmountGnf,
        distanceMeters: priced.distanceMeters,
        durationMinutes: priced.durationMinutes,
        route,
      }),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : ROUTE_UNAVAILABLE;
    if (message === "distance_too_far" || message === "taxi_distance_too_far") {
      return taxiJson({ ok: false, error: "taxi_distance_too_far" }, 400);
    }
    if (message === "guinea_standard_distance_exceeded") {
      return taxiJson({ ok: false, error: "guinea_standard_distance_exceeded" }, 400);
    }
    if (
      message === "MAPBOX_ACCESS_TOKEN missing" ||
      message.startsWith("geographic_validation_unavailable")
    ) {
      return taxiJson({ ok: false, error: "geographic_validation_unavailable" }, 503);
    }
    if (
      message === "country_mismatch" ||
      message === "cross_country_route_not_supported" ||
      message === "market_mismatch"
    ) {
      return taxiJson({ ok: false, error: "market_mismatch" }, 400);
    }
    return taxiJson({ ok: false, error: ROUTE_UNAVAILABLE }, 400);
  }
}

export async function maybeCreateGuineaCashTaxi(input: PointInput & {
  supabaseAdmin: SupabaseClient;
  userId: string;
  passengerCount: number;
}) {
  const decision = guineaDecision(input);
  if (decision.kind === "us") return null;
  if (decision.kind === "reject") {
    return taxiJson({ ok: false, error: decision.error }, decision.status);
  }

  const method = requestedMethod(input.paymentMethod) || "cash";
  if (method === "orange_money" || method === "orange_money_gn") {
    return taxiJson({ ok: false, error: "orange_money_disabled" }, 403);
  }
  if (method !== "cash") {
    return taxiJson({ ok: false, error: "cash_required" }, 400);
  }
  if (
    input.premiumDriverOnly === true ||
    String(input.businessAccountId ?? "").trim() ||
    String(input.promoCode ?? "").trim() ||
    String(input.rewardId ?? "").trim()
  ) {
    return taxiJson({ ok: false, error: "guinea_options_not_supported" }, 400);
  }

  const platform = await assertPlatformFeature(
    input.supabaseAdmin,
    GUINEA_COUNTRY_CODE,
    "taxi",
    "active",
  );
  if (platform.ok === false) {
    return taxiJson({ ok: false, ...(platform as unknown as Record<string, unknown>) }, 403);
  }

  const passengers = resolveGuineaPassengerCount(input.passengerCount, decision.vehicle);
  if (passengers.ok === false) {
    return taxiJson({ ok: false, error: passengers.error }, 400);
  }
  const commercial = await loadCommercialConfig(input.supabaseAdmin);
  if (commercial.ok === false) {
    return taxiJson({ ok: false, error: commercial.error }, 503);
  }
  const commissionBps = commercial.bps;

  let route;
  let priced;
  let evidence;
  try {
    const resolved = await routeAndPrice(input, commercial.card);
    route = resolved.route;
    priced = resolved.priced;
    evidence = resolved.evidence;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : ROUTE_UNAVAILABLE;
    if (message === "distance_too_far" || message === "taxi_distance_too_far") {
      return taxiJson({ ok: false, error: "taxi_distance_too_far" }, 400);
    }
    if (message === "guinea_standard_distance_exceeded") {
      return taxiJson({ ok: false, error: "guinea_standard_distance_exceeded" }, 400);
    }
    if (
      message === "MAPBOX_ACCESS_TOKEN missing" ||
      message.startsWith("geographic_validation_unavailable")
    ) {
      return taxiJson({ ok: false, error: "geographic_validation_unavailable" }, 503);
    }
    if (
      message === "country_mismatch" ||
      message === "cross_country_route_not_supported" ||
      message === "market_mismatch"
    ) {
      return taxiJson({ ok: false, error: "market_mismatch" }, 400);
    }
    return taxiJson({ ok: false, error: ROUTE_UNAVAILABLE }, 400);
  }

  if (priced.ok === false) {
    return taxiJson({ ok: false, error: priced.error }, 400);
  }

  const fareGnf = priced.fareGnf;
  const split = splitGuineaStandardCommission(fareGnf, commissionBps);
  if (!split) {
    return taxiJson({ ok: false, error: "guinea_commission_not_configured" }, 503);
  }
  const quotedAt = new Date().toISOString();
  const snapshot = freezeGuineaStandardSnapshot({
    distanceMeters: priced.distanceMeters,
    durationMinutes: priced.durationMinutes,
    fareGnf,
    platformShareBps: commissionBps,
    platformFeeGnf: split.platformFeeGnf,
    driverAmountGnf: split.driverAmountGnf,
    baseFareGnf: commercial.card.baseFareGnf,
    perKmGnf: commercial.card.perKmGnf,
    perMinuteGnf: commercial.card.perMinuteGnf,
    minimumFareGnf: commercial.card.minimumFareGnf,
    maximumFareGnf: commercial.card.maximumFareGnf,
    vehicle: decision.vehicle,
    passengerCount: passengers.passengerCount,
    quotedAt,
  });
  const pickupLocality =
    localityLabel(input.pickupAddress) ??
    localityLabel(evidence.pickup.canonicalAddress);
  const dropoffLocality =
    localityLabel(input.dropoffAddress) ??
    localityLabel(evidence.dropoff.canonicalAddress);
  const pickupAddress = storedAddress(
    input.pickupAddress || evidence.pickup.canonicalAddress,
    route.pickupLat,
    route.pickupLng,
  );
  const dropoffAddress = storedAddress(
    input.dropoffAddress || evidence.dropoff.canonicalAddress,
    route.dropoffLat,
    route.dropoffLng,
  );

  const row = {
    client_user_id: input.userId,
    vehicle_class: decision.vehicle === "motorcycle" ? "motorcycle" : "standard",
    status: "dispatching",
    pickup_address: pickupAddress,
    pickup_lat: route.pickupLat,
    pickup_lng: route.pickupLng,
    pickup_city: pickupLocality,
    dropoff_address: dropoffAddress,
    dropoff_lat: route.dropoffLat,
    dropoff_lng: route.dropoffLng,
    distance_miles: route.distanceMiles,
    duration_minutes: route.durationMinutes,
    country_code: GUINEA_COUNTRY_CODE,
    currency: GUINEA_CURRENCY,
    subtotal_cents: fareGnf,
    tax_cents: 0,
    platform_fee_cents: split.platformFeeGnf,
    driver_payout_cents: split.driverAmountGnf,
    service_fee_cents: 0,
    total_cents: fareGnf,
    gross_total_cents: fareGnf,
    passenger_count: passengers.passengerCount,
    payment_status: "pending_cash",
    payment_method: "cash",
    payment_funding: "cash",
    stripe_session_id: null,
    stripe_payment_intent_id: null,
    trip_mode: "one_way",
    client_notes: driverNote(input.clientNotes),
    fare_components: {
      ...snapshot,
      locality: pickupLocality,
      destination_locality: dropoffLocality,
      region: evidence.pickup.region,
      payment_method: "cash",
    },
  };

  let inserted = await input.supabaseAdmin
    .from("taxi_rides")
    .insert(row)
    .select("id,status,payment_status,payment_method,currency,total_cents,country_code,pickup_city")
    .single();

  if (
    inserted.error &&
    /fare_components|column/i.test(String(inserted.error.message ?? ""))
  ) {
    const { fare_components: _omit, ...withoutComponents } = row;
    void _omit;
    inserted = await input.supabaseAdmin
      .from("taxi_rides")
      .insert(withoutComponents)
      .select("id,status,payment_status,payment_method,currency,total_cents,country_code,pickup_city")
      .single();
  }

  if (inserted.error || !inserted.data) {
    const message = String(inserted.error?.message ?? "create_failed");
    if (/vehicle_class/i.test(message)) {
      return taxiJson({ ok: false, error: "guinea_motorcycle_schema_not_ready" }, 503);
    }
    if (/payment_method|payment_status|check constraint/i.test(message)) {
      return taxiJson({ ok: false, error: "guinea_schema_not_ready" }, 503);
    }
    return taxiJson({ ok: false, error: "create_failed" }, 500);
  }

  const rideId = String(inserted.data.id);
  const dispatch = await runTaxiRideDispatch({
    supabase: input.supabaseAdmin,
    taxiRideId: rideId,
  });

  return taxiJson({
    ok: true,
    market: "GN",
    country_code: GUINEA_COUNTRY_CODE,
    locality: pickupLocality,
    city: pickupLocality,
    currency: GUINEA_CURRENCY,
    payment_method: "cash",
    payment_status: "pending_cash",
    pooling: chooseGuineaPoolProposal({
      sharedRide: input.sharedRide === true,
      vehicle: decision.vehicle,
      limits: readGuineaPoolLimits(),
      incomingPassengers: passengers.passengerCount,
      candidates: [],
      nowMs: Date.now(),
    }),
    ride: inserted.data,
    dispatch: {
      ok: dispatch.ok,
      notified: dispatch.notified,
      candidates: dispatch.candidates,
    },
  });
}

function snapshotFromRow(row: Record<string, unknown>): CashRideSnapshot {
  return {
    id: String(row.id ?? ""),
    clientUserId: row.client_user_id != null ? String(row.client_user_id) : null,
    driverId: row.driver_id != null ? String(row.driver_id) : null,
    status: row.status != null ? String(row.status) : null,
    paymentMethod: row.payment_method != null ? String(row.payment_method) : null,
    paymentStatus: row.payment_status != null ? String(row.payment_status) : null,
    currency: row.currency != null ? String(row.currency) : null,
    countryCode: row.country_code != null ? String(row.country_code) : null,
    totalCents: row.total_cents != null ? Number(row.total_cents) : null,
  };
}

const CASH_RIDE_COLUMNS =
  "id,client_user_id,driver_id,status,payment_method,payment_status,currency,country_code,total_cents";

async function ensureCashCollectionLedger(
  supabaseAdmin: SupabaseClient,
  rideId: string,
  driverUserId: string,
  fareGnf: number,
): Promise<boolean> {
  const existingLedger = await supabaseAdmin
    .from("wallet_ledger")
    .select("id")
    .eq("reference_type", "cash_collection")
    .eq("reference_id", rideId)
    .limit(1)
    .maybeSingle();
  if (existingLedger.data?.id) return true;

  const ledger = await supabaseAdmin.from("wallet_ledger").insert(
    buildCashCollectionLedgerRow({
      rideId,
      driverUserId,
      fareGnf,
    }),
  );
  if (!ledger.error) return true;
  return /duplicate|unique/i.test(ledger.error.message);
}

export async function collectGuineaCash(input: {
  supabaseAdmin: SupabaseClient;
  actorUserId: string;
  rideId: string;
}) {
  const loaded = await input.supabaseAdmin
    .from("taxi_rides")
    .select(CASH_RIDE_COLUMNS)
    .eq("id", input.rideId)
    .maybeSingle();

  if (loaded.error) {
    if (/payment_method/i.test(loaded.error.message)) {
      return taxiJson({ ok: false, error: "guinea_schema_not_ready" }, 503);
    }
    return taxiJson({ ok: false, error: "ride_lookup_failed" }, 500);
  }

  const decision = evaluateCashCollection(
    loaded.data ? snapshotFromRow(loaded.data as Record<string, unknown>) : null,
    input.actorUserId,
  );
  if (decision.ok === false) {
    return taxiJson({ ok: false, error: decision.error }, decision.status);
  }
  if (decision.idempotent) {
    const ledgerRecorded = await ensureCashCollectionLedger(
      input.supabaseAdmin,
      input.rideId,
      input.actorUserId,
      decision.fareGnf,
    );
    return taxiJson({
      ok: true,
      idempotent: true,
      payment_method: "cash",
      payment_status: "cash_collected",
      fare_gnf: decision.fareGnf,
      currency: GUINEA_CURRENCY,
      ledger_recorded: ledgerRecorded,
    });
  }

  const updated = await input.supabaseAdmin
    .from("taxi_rides")
    .update({
      payment_status: "cash_collected",
      paid_at: new Date().toISOString(),
    })
    .eq("id", input.rideId)
    .eq("driver_id", input.actorUserId)
    .eq("payment_method", "cash")
    .eq("payment_status", "pending_cash")
    .eq("status", "completed")
    .eq("currency", GUINEA_CURRENCY)
    .eq("country_code", GUINEA_COUNTRY_CODE)
    .select("id,total_cents,payment_status")
    .maybeSingle();

  if (updated.error) {
    return taxiJson({ ok: false, error: "cash_collect_failed" }, 500);
  }

  if (!updated.data) {
    const again = await input.supabaseAdmin
      .from("taxi_rides")
      .select(CASH_RIDE_COLUMNS)
      .eq("id", input.rideId)
      .maybeSingle();
    const second = evaluateCashCollection(
      again.data ? snapshotFromRow(again.data as Record<string, unknown>) : null,
      input.actorUserId,
    );
    if (second.ok && second.idempotent) {
      const ledgerRecorded = await ensureCashCollectionLedger(
        input.supabaseAdmin,
        input.rideId,
        input.actorUserId,
        second.fareGnf,
      );
      return taxiJson({
        ok: true,
        idempotent: true,
        payment_method: "cash",
        payment_status: "cash_collected",
        fare_gnf: second.fareGnf,
        currency: GUINEA_CURRENCY,
        ledger_recorded: ledgerRecorded,
      });
    }
    return taxiJson({ ok: false, error: "cash_collect_conflict" }, 409);
  }

  const fareGnf = Number(updated.data.total_cents);
  const ledgerRecorded = await ensureCashCollectionLedger(
    input.supabaseAdmin,
    input.rideId,
    input.actorUserId,
    fareGnf,
  );

  return taxiJson({
    ok: true,
    idempotent: false,
    payment_method: "cash",
    payment_status: "cash_collected",
    fare_gnf: fareGnf,
    currency: GUINEA_CURRENCY,
    ledger_recorded: ledgerRecorded,
  });
}
