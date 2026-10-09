import type { SupabaseClient } from "@supabase/supabase-js";
import { taxiJson } from "@/lib/taxiApi";
import { detectTaxiCountryFromCoords } from "@/lib/taxiCountryDetection";
import { detectTaxiCityFromCoords } from "@/lib/taxiCityDetection";
import {
  bookXlSeats,
  collectXlCash,
  completeXlDeparture,
  emptyXlStore,
  openXlDeparture,
  type XlBooking,
  type XlStore,
} from "@/lib/markets/guineaXlBooking";
import {
  findActiveXlAxis,
  isXlCapacity,
  type XlAxisRecord,
  type XlBaggageBand,
} from "@/lib/markets/guineaXlPricing";

function schemaMissing(message: string): boolean {
  return /guinea_xl_|schema cache|does not exist/i.test(message);
}

function jsonError(error: string, status: number) {
  return taxiJson({ ok: false, error }, status);
}

async function loadCatalog(supabaseAdmin: SupabaseClient): Promise<
  { ok: true; store: XlStore; axes: XlAxisRecord[] } | { ok: false; response: Response }
> {
  const [settings, bands, axes] = await Promise.all([
    supabaseAdmin.from("guinea_xl_settings").select("platform_share_bps").eq("id", "GN").maybeSingle(),
    supabaseAdmin
      .from("guinea_xl_baggage_bands")
      .select("id,min_kg,max_kg,price_gnf,active")
      .eq("active", true),
    supabaseAdmin
      .from("guinea_xl_axes")
      .select(
        "id,origin_key,destination_key,origin_label,destination_label,route_key,directional,active,version,front_seat_gnf,other_seat_gnf",
      )
      .eq("active", true),
  ]);
  const error = settings.error ?? bands.error ?? axes.error;
  if (error) {
    if (schemaMissing(error.message)) return { ok: false, response: jsonError("xl_schema_not_ready", 503) };
    return { ok: false, response: jsonError("xl_catalog_failed", 500) };
  }
  const store = emptyXlStore();
  store.platformShareBps =
    typeof settings.data?.platform_share_bps === "number" ? settings.data.platform_share_bps : null;
  store.bands = ((bands.data ?? []) as Array<Record<string, unknown>>).map(
    (band): XlBaggageBand => ({
      id: String(band.id),
      minKg: Number(band.min_kg),
      maxKg: Number(band.max_kg),
      priceGnf: Number(band.price_gnf),
      active: band.active !== false,
    }),
  );
  store.axes = ((axes.data ?? []) as Array<Record<string, unknown>>).map(mapAxis);
  return { ok: true, store, axes: store.axes };
}

function mapAxis(row: Record<string, unknown>): XlAxisRecord {
  return {
    id: String(row.id),
    originKey: String(row.origin_key),
    destinationKey: String(row.destination_key),
    routeKey: String(row.route_key),
    directional: row.directional === true,
    active: row.active !== false,
    rate: {
      versionId: String(row.version),
      frontSeatGnf: Number(row.front_seat_gnf),
      otherSeatGnf: Number(row.other_seat_gnf),
      active: row.active !== false,
    },
  };
}

async function placesFromCoords(pickupLat: unknown, pickupLng: unknown, dropoffLat: unknown, dropoffLng: unknown) {
  const [pickupCountry, dropoffCountry, originLabel, destinationLabel] = await Promise.all([
    detectTaxiCountryFromCoords(Number(pickupLat), Number(pickupLng)),
    detectTaxiCountryFromCoords(Number(dropoffLat), Number(dropoffLng)),
    detectTaxiCityFromCoords(pickupLat, pickupLng),
    detectTaxiCityFromCoords(dropoffLat, dropoffLng),
  ]);
  return { pickupCountry, dropoffCountry, originLabel, destinationLabel };
}

function seatIndexes(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => Number(item)).filter((item) => Number.isInteger(item));
}

function baggageItems(value: unknown): Array<{ weightKg: unknown }> {
  if (!Array.isArray(value)) return [];
  return value.map((item) => ({
    weightKg: item && typeof item === "object" ? (item as { weightKg?: unknown }).weightKg : item,
  }));
}

export async function quoteGuineaXl(supabaseAdmin: SupabaseClient, body: Record<string, unknown>) {
  const catalog = await loadCatalog(supabaseAdmin);
  if (catalog.ok === false) return catalog.response;
  const places = await placesFromCoords(body.pickupLat, body.pickupLng, body.dropoffLat, body.dropoffLng);
  if (!places.pickupCountry || !places.dropoffCountry || !places.originLabel || !places.destinationLabel) {
    return jsonError("geographic_validation_unavailable", 503);
  }
  const departureId = String(body.departureId ?? "");
  const departure = await supabaseAdmin
    .from("guinea_xl_departures")
    .select("id,axis_id,driver_id,passenger_capacity,status")
    .eq("id", departureId)
    .maybeSingle();
  if (departure.error) {
    if (schemaMissing(departure.error.message)) return jsonError("xl_schema_not_ready", 503);
    return jsonError("xl_departure_unavailable", 404);
  }
  if (!departure.data || departure.data.status !== "open") return jsonError("xl_departure_unavailable", 409);
  const seats = await supabaseAdmin
    .from("guinea_xl_seats")
    .select("seat_index,booking_id")
    .eq("departure_id", departureId);
  if (seats.error) return jsonError("xl_departure_unavailable", 409);
  const opened = openXlDeparture(catalog.store, {
    id: String(departure.data.id),
    axisId: String(departure.data.axis_id),
    driverId: String(departure.data.driver_id),
    capacity: Number(departure.data.passenger_capacity),
  });
  if (opened.ok === false) return jsonError(opened.error, 400);
  const live = opened.store.departures[0];
  if (live) {
    for (const seat of (seats.data ?? []) as Array<Record<string, unknown>>) {
      const found = live.seats.find((item) => item.index === Number(seat.seat_index));
      if (found) found.bookingId = seat.booking_id ? String(seat.booking_id) : null;
    }
  }
  const decision = bookXlSeats(opened.store, {
    bookingId: "quote",
    idempotencyKey: `quote-${Date.now()}`,
    clientUserId: "quote",
    departureId,
    detectedCountryCodes: [places.pickupCountry, places.dropoffCountry],
    claimedCountryCode: body.countryCode ?? body.country_code,
    claimedCurrency: body.currency,
    claimedTotalGnf: body.totalGnf ?? body.total,
    claimedBaggageGnf: body.baggageGnf ?? body.baggageTotal,
    originLabel: places.originLabel,
    destinationLabel: places.destinationLabel,
    seatIndexes: seatIndexes(body.seatIndexes),
    baggage: baggageItems(body.baggage),
  });
  if (decision.ok === false) return jsonError(decision.error, 400);
  return taxiJson({
    ok: true,
    currency: "GNF",
    country_code: "GN",
    payment_method: "cash",
    quote: decision.booking.quote,
  });
}

export async function bookGuineaXl(
  supabaseAdmin: SupabaseClient,
  clientUserId: string,
  body: Record<string, unknown>,
) {
  const idempotencyKey = String(body.idempotencyKey ?? body.idempotency_key ?? "").trim();
  if (!idempotencyKey || idempotencyKey.length > 80) return jsonError("xl_booking_invalid", 400);
  const existing = await supabaseAdmin
    .from("guinea_xl_bookings")
    .select("id,total_gnf,currency,payment_status,driver_amount_gnf,platform_fee_gnf,transport_gnf,baggage_gnf")
    .eq("client_user_id", clientUserId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (existing.error) {
    if (schemaMissing(existing.error.message)) return jsonError("xl_schema_not_ready", 503);
    return jsonError("xl_booking_invalid", 400);
  }
  if (existing.data) {
    return taxiJson({ ok: true, idempotent: true, booking: existing.data });
  }

  const catalog = await loadCatalog(supabaseAdmin);
  if (catalog.ok === false) return catalog.response;
  const places = await placesFromCoords(body.pickupLat, body.pickupLng, body.dropoffLat, body.dropoffLng);
  if (!places.pickupCountry || !places.dropoffCountry || !places.originLabel || !places.destinationLabel) {
    return jsonError("geographic_validation_unavailable", 503);
  }
  const departureId = String(body.departureId ?? "");
  const [departure, seats] = await Promise.all([
    supabaseAdmin
      .from("guinea_xl_departures")
      .select("id,axis_id,driver_id,passenger_capacity,status")
      .eq("id", departureId)
      .maybeSingle(),
    supabaseAdmin.from("guinea_xl_seats").select("seat_index,seat_role,booking_id").eq("departure_id", departureId),
  ]);
  if (departure.error || seats.error || !departure.data) return jsonError("xl_departure_unavailable", 409);
  const opened = openXlDeparture(catalog.store, {
    id: departureId,
    axisId: String(departure.data.axis_id),
    driverId: String(departure.data.driver_id),
    capacity: Number(departure.data.passenger_capacity),
  });
  if (opened.ok === false) return jsonError(opened.error, 400);
  const live = opened.store.departures[0];
  if (live) {
    for (const seat of (seats.data ?? []) as Array<Record<string, unknown>>) {
      const found = live.seats.find((item) => item.index === Number(seat.seat_index));
      if (found) found.bookingId = seat.booking_id ? String(seat.booking_id) : null;
    }
  }
  const bookingId = crypto.randomUUID();
  const decision = bookXlSeats(opened.store, {
    bookingId,
    idempotencyKey,
    clientUserId,
    departureId,
    detectedCountryCodes: [places.pickupCountry, places.dropoffCountry],
    claimedCountryCode: body.countryCode ?? body.country_code,
    claimedCurrency: body.currency,
    claimedTotalGnf: body.totalGnf ?? body.total,
    claimedBaggageGnf: body.baggageGnf ?? body.baggageTotal,
    originLabel: places.originLabel,
    destinationLabel: places.destinationLabel,
    seatIndexes: seatIndexes(body.seatIndexes),
    baggage: baggageItems(body.baggage),
  });
  if (decision.ok === false) return jsonError(decision.error, 400);
  const quote = decision.booking.quote;
  const saved = await supabaseAdmin.rpc("create_guinea_xl_booking", {
    p_booking_id: bookingId,
    p_idempotency_key: idempotencyKey,
    p_client_user_id: clientUserId,
    p_departure_id: departureId,
    p_seat_indexes: decision.booking.seatIndexes,
    p_snapshot: {
      currency: "GNF",
      country_code: "GN",
      payment_method: "cash",
      rate_version: Number(quote.rateVersionId),
      front_seat_gnf: quote.frontSeatGnf,
      other_seat_gnf: quote.otherSeatGnf,
      front_seat_count: quote.frontSeatCount,
      other_seat_count: quote.otherSeatCount,
      transport_gnf: quote.transportGnf,
      baggage_gnf: quote.baggageGnf,
      total_gnf: quote.totalGnf,
      platform_share_bps: quote.platformShareBps,
      platform_fee_gnf: quote.platformFeeGnf,
      driver_amount_gnf: quote.driverAmountGnf,
      baggage_lines: quote.baggageLines,
    },
  });
  if (saved.error) {
    if (schemaMissing(saved.error.message)) return jsonError("xl_schema_not_ready", 503);
    if (/xl_seat_taken/i.test(saved.error.message)) return jsonError("xl_seat_taken", 409);
    return jsonError("xl_booking_invalid", 400);
  }
  const payload = saved.data as { ok?: boolean; error?: string; idempotent?: boolean; booking_id?: string };
  if (payload?.ok === false) return jsonError(String(payload.error ?? "xl_booking_invalid"), 409);
  return taxiJson({
    ok: true,
    idempotent: payload?.idempotent === true,
    booking_id: payload?.booking_id ?? bookingId,
    currency: "GNF",
    payment_method: "cash",
    payment_status: "pending_cash",
    quote,
  });
}

export async function openGuineaXlDeparture(
  supabaseAdmin: SupabaseClient,
  driverId: string,
  body: Record<string, unknown>,
) {
  const capacity = Number(body.capacity);
  if (!isXlCapacity(capacity)) return jsonError("xl_vehicle_capacity_unsupported", 400);
  const features = await supabaseAdmin
    .from("taxi_driver_features")
    .select("passenger_capacity,xl_eligible")
    .eq("user_id", driverId)
    .maybeSingle();
  if (features.error) return jsonError("xl_vehicle_capacity_unsupported", 400);
  const declared = Number(features.data?.passenger_capacity ?? 0);
  if (features.data?.xl_eligible !== true || !Number.isSafeInteger(declared) || declared < capacity) {
    return jsonError("xl_vehicle_capacity_unsupported", 400);
  }
  const inserted = await supabaseAdmin
    .from("guinea_xl_departures")
    .insert({
      axis_id: String(body.axisId ?? ""),
      driver_id: driverId,
      passenger_capacity: capacity,
      scheduled_at: body.scheduledAt ? String(body.scheduledAt) : null,
      status: "open",
      country_code: "GN",
      currency: "GNF",
    })
    .select("id,passenger_capacity,status,scheduled_at")
    .maybeSingle();
  if (inserted.error) {
    if (schemaMissing(inserted.error.message)) return jsonError("xl_schema_not_ready", 503);
    return jsonError("xl_departure_unavailable", 400);
  }
  return taxiJson({ ok: true, departure: inserted.data });
}

export async function listDriverGuineaXlDepartures(supabaseAdmin: SupabaseClient, driverId: string) {
  const rows = await supabaseAdmin
    .from("guinea_xl_departures")
    .select(
      "id,axis_id,driver_id,passenger_capacity,scheduled_at,status,guinea_xl_seats(seat_index,seat_role,booking_id),guinea_xl_axes(origin_label,destination_label,currency)",
    )
    .eq("driver_id", driverId)
    .order("created_at", { ascending: false });
  if (rows.error) {
    if (schemaMissing(rows.error.message)) return jsonError("xl_schema_not_ready", 503);
    return jsonError("xl_departure_unavailable", 500);
  }
  const departureIds = (rows.data ?? []).map((row) => String(row.id));
  const bookings = departureIds.length
    ? await supabaseAdmin
        .from("guinea_xl_bookings")
        .select(
          "id,departure_id,seat_indexes,status,payment_status,payment_method,total_gnf,transport_gnf,baggage_gnf,driver_amount_gnf,platform_fee_gnf",
        )
        .eq("driver_id", driverId)
        .in("departure_id", departureIds)
    : { data: [], error: null };
  if (bookings.error) {
    if (schemaMissing(bookings.error.message)) return jsonError("xl_schema_not_ready", 503);
    return jsonError("xl_departure_unavailable", 500);
  }
  const byDeparture = new Map<string, Array<Record<string, unknown>>>();
  for (const booking of (bookings.data ?? []) as Array<Record<string, unknown>>) {
    const departureId = String(booking.departure_id);
    const list = byDeparture.get(departureId) ?? [];
    list.push(booking);
    byDeparture.set(departureId, list);
  }
  return taxiJson({
    ok: true,
    departures: (rows.data ?? []).map((row) => ({
      ...row,
      bookings: byDeparture.get(String(row.id)) ?? [],
    })),
  });
}

export async function listOpenGuineaXlDepartures(supabaseAdmin: SupabaseClient) {
  const [rows, axes] = await Promise.all([
    supabaseAdmin
      .from("guinea_xl_departures")
      .select(
        "id,axis_id,driver_id,passenger_capacity,scheduled_at,status,guinea_xl_seats(seat_index,seat_role,booking_id),guinea_xl_axes(origin_label,destination_label,front_seat_gnf,other_seat_gnf,currency)",
      )
      .eq("status", "open"),
    supabaseAdmin
      .from("guinea_xl_axes")
      .select("id,origin_label,destination_label,front_seat_gnf,other_seat_gnf,currency,active")
      .eq("active", true),
  ]);
  if (rows.error || axes.error) {
    const message = rows.error?.message ?? axes.error?.message ?? "";
    if (schemaMissing(message)) return jsonError("xl_schema_not_ready", 503);
    return jsonError("xl_departure_unavailable", 500);
  }
  return taxiJson({ ok: true, departures: rows.data ?? [], axes: axes.data ?? [] });
}

export function bookingSnapshot(booking: XlBooking) {
  return booking.quote;
}

export async function completeGuineaXlDeparture(
  supabaseAdmin: SupabaseClient,
  driverId: string,
  departureId: string,
) {
  const loaded = await supabaseAdmin
    .from("guinea_xl_departures")
    .select("id,driver_id,status")
    .eq("id", departureId)
    .maybeSingle();
  if (loaded.error || !loaded.data) return jsonError("xl_departure_unavailable", 404);
  const store = emptyXlStore();
  store.departures = [
    {
      id: String(loaded.data.id),
      axisId: "axis",
      driverId: String(loaded.data.driver_id),
      capacity: 4,
      status: loaded.data.status === "canceled" ? "canceled" : loaded.data.status === "completed" ? "completed" : "open",
      seats: [],
    },
  ];
  const decision = completeXlDeparture(store, { departureId, actorUserId: driverId });
  if (decision.ok === false) return jsonError(decision.error, 403);
  const updated = await supabaseAdmin
    .from("guinea_xl_departures")
    .update({ status: "completed" })
    .eq("id", departureId)
    .eq("driver_id", driverId)
    .neq("status", "canceled");
  if (updated.error) return jsonError("xl_departure_unavailable", 400);
  await supabaseAdmin
    .from("guinea_xl_bookings")
    .update({ status: "completed" })
    .eq("departure_id", departureId)
    .eq("status", "confirmed");
  return taxiJson({ ok: true });
}

export async function collectGuineaXlCash(
  supabaseAdmin: SupabaseClient,
  actorUserId: string,
  bookingId: string,
) {
  const loaded = await supabaseAdmin
    .from("guinea_xl_bookings")
    .select(
      "id,driver_id,status,payment_method,payment_status,currency,country_code,total_gnf,driver_amount_gnf,platform_fee_gnf,transport_gnf,baggage_gnf",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (loaded.error) {
    if (schemaMissing(loaded.error.message)) return jsonError("xl_schema_not_ready", 503);
    return jsonError("ride_not_found", 404);
  }
  if (!loaded.data) return jsonError("ride_not_found", 404);
  const row = loaded.data;
  const store = emptyXlStore();
  store.bookings = [
    {
      id: String(row.id),
      idempotencyKey: "loaded",
      clientUserId: "client",
      driverId: String(row.driver_id),
      departureId: "departure",
      axisId: "axis",
      seatIndexes: [],
      status: row.status === "canceled" ? "canceled" : row.status === "completed" ? "completed" : "confirmed",
      paymentMethod: "cash",
      paymentStatus: row.payment_status === "cash_collected" ? "cash_collected" : "pending_cash",
      quote: {
        frontSeatCount: 0,
        otherSeatCount: 0,
        passengerCount: 0,
        frontSeatGnf: 0,
        otherSeatGnf: 0,
        transportGnf: Number(row.transport_gnf),
        baggageGnf: Number(row.baggage_gnf),
        totalGnf: Number(row.total_gnf),
        platformShareBps: 0,
        platformFeeGnf: Number(row.platform_fee_gnf),
        driverAmountGnf: Number(row.driver_amount_gnf),
        currency: "GNF",
        countryCode: "GN",
        rateVersionId: "loaded",
        baggageLines: [],
      },
    },
  ];
  const decision = collectXlCash(store, { bookingId, actorUserId });
  if (decision.ok === false) {
    const status =
      decision.error === "ride_not_found" ? 404 : decision.error === "cash_forbidden" ? 403 : 409;
    return jsonError(decision.error, status);
  }
  if (!decision.idempotent) {
    const updated = await supabaseAdmin
      .from("guinea_xl_bookings")
      .update({ payment_status: "cash_collected" })
      .eq("id", bookingId)
      .eq("driver_id", actorUserId)
      .eq("status", "completed")
      .eq("payment_status", "pending_cash")
      .eq("currency", "GNF")
      .eq("country_code", "GN");
    if (updated.error) return jsonError("cash_collect_failed", 500);
  }
  return taxiJson({
    ok: true,
    idempotent: decision.idempotent,
    currency: "GNF",
    total_gnf: decision.totalGnf,
    payment_status: "cash_collected",
  });
}

export function activeAxisForLabels(axes: XlAxisRecord[], origin: string, destination: string) {
  return findActiveXlAxis(axes, origin, destination);
}
