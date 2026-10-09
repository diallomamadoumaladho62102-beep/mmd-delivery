/**
 * XL booking state. Confirmed snapshots stay frozen when Admin changes a rate.
 * Ledger rows for baggage are intentionally absent: baggage stays on the booking
 * and is not mixed into the seat price or the shared wallet_ledger.
 */

import {
  buildXlSeats,
  findActiveXlAxis,
  isXlCapacity,
  quoteXlReservation,
  reserveXlSeats,
  type XlAxisRecord,
  type XlBaggageBand,
  type XlBaggageItem,
  type XlQuote,
  type XlSeat,
} from "@/lib/markets/guineaXlPricing";

export type XlDeparture = {
  id: string;
  axisId: string;
  driverId: string;
  capacity: 4 | 5 | 6 | 7;
  status: "open" | "closed" | "canceled" | "completed";
  seats: XlSeat[];
};

export type XlBooking = {
  id: string;
  idempotencyKey: string;
  clientUserId: string;
  driverId: string;
  departureId: string;
  axisId: string;
  seatIndexes: number[];
  status: "confirmed" | "completed" | "canceled";
  paymentMethod: "cash";
  paymentStatus: "pending_cash" | "cash_collected";
  quote: XlQuote;
};

export type XlLedgerEntry = {
  bookingId: string;
  entryKind: "driver_transport" | "platform_transport";
  amountGnf: number;
  currency: "GNF";
};

export type XlAudit = {
  actorId: string;
  axisId: string;
  action: string;
  oldValue: unknown;
  newValue: unknown;
  reason: string | null;
};

export type XlStore = {
  axes: XlAxisRecord[];
  bands: XlBaggageBand[];
  platformShareBps: number | null;
  departures: XlDeparture[];
  bookings: XlBooking[];
  ledger: XlLedgerEntry[];
  audit: XlAudit[];
};

export function emptyXlStore(): XlStore {
  return {
    axes: [],
    bands: [],
    platformShareBps: null,
    departures: [],
    bookings: [],
    ledger: [],
    audit: [],
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function openXlDeparture(
  store: XlStore,
  input: { id: string; axisId: string; driverId: string; capacity: unknown },
): { ok: true; store: XlStore } | { ok: false; error: string } {
  if (!isXlCapacity(input.capacity)) return { ok: false, error: "xl_vehicle_capacity_unsupported" };
  const axis = store.axes.find((item) => item.id === input.axisId && item.active);
  if (!axis) return { ok: false, error: "xl_route_not_configured" };
  const next = clone(store);
  next.departures.push({
    id: input.id,
    axisId: input.axisId,
    driverId: input.driverId,
    capacity: input.capacity,
    status: "open",
    seats: buildXlSeats(input.capacity),
  });
  return { ok: true, store: next };
}

export function bookXlSeats(
  store: XlStore,
  input: {
    bookingId: string;
    idempotencyKey: string;
    clientUserId: string;
    departureId: string;
    detectedCountryCodes: Array<string | null | undefined>;
    claimedCountryCode?: unknown;
    claimedCurrency?: unknown;
    claimedTotalGnf?: unknown;
    claimedBaggageGnf?: unknown;
    originLabel: unknown;
    destinationLabel: unknown;
    seatIndexes: number[];
    baggage: XlBaggageItem[];
  },
): { ok: true; store: XlStore; booking: XlBooking; idempotent: boolean } | { ok: false; error: string } {
  const existing = store.bookings.find(
    (booking) =>
      booking.clientUserId === input.clientUserId && booking.idempotencyKey === input.idempotencyKey,
  );
  if (existing) return { ok: true, store, booking: existing, idempotent: true };

  const departure = store.departures.find((item) => item.id === input.departureId);
  if (!departure || departure.status !== "open") return { ok: false, error: "xl_departure_unavailable" };
  const axis = store.axes.find((item) => item.id === departure.axisId) ?? null;
  const resolved = findActiveXlAxis(axis ? [axis] : [], input.originLabel, input.destinationLabel);
  if (!resolved || resolved.id !== departure.axisId) return { ok: false, error: "xl_route_not_configured" };
  const quote = quoteXlReservation({
    detectedCountryCodes: input.detectedCountryCodes,
    claimedCountryCode: input.claimedCountryCode,
    claimedCurrency: input.claimedCurrency,
    claimedTotalGnf: input.claimedTotalGnf,
    claimedBaggageGnf: input.claimedBaggageGnf,
    axis,
    capacity: departure.capacity,
    seatIndexes: input.seatIndexes,
    baggage: input.baggage,
    bands: store.bands,
    platformShareBps: store.platformShareBps,
  });
  if (quote.ok === false) return quote;

  const reserved = reserveXlSeats(departure.seats, input.seatIndexes, input.bookingId);
  if (reserved.ok === false) return reserved;

  const booking: XlBooking = {
    id: input.bookingId,
    idempotencyKey: input.idempotencyKey,
    clientUserId: input.clientUserId,
    driverId: departure.driverId,
    departureId: departure.id,
    axisId: departure.axisId,
    seatIndexes: [...input.seatIndexes],
    status: "confirmed",
    paymentMethod: "cash",
    paymentStatus: "pending_cash",
    quote: quote.quote,
  };
  const next = clone(store);
  const saved = next.departures.find((item) => item.id === departure.id);
  if (!saved) return { ok: false, error: "xl_departure_unavailable" };
  saved.seats = reserved.seats;
  next.bookings.push(booking);
  next.ledger.push(
    {
      bookingId: booking.id,
      entryKind: "driver_transport",
      amountGnf: booking.quote.driverAmountGnf,
      currency: "GNF",
    },
    {
      bookingId: booking.id,
      entryKind: "platform_transport",
      amountGnf: booking.quote.platformFeeGnf,
      currency: "GNF",
    },
  );
  return { ok: true, store: next, booking, idempotent: false };
}

export function recordXlLedgerOnce(store: XlStore, booking: XlBooking): XlStore {
  const next = clone(store);
  for (const entryKind of ["driver_transport", "platform_transport"] as const) {
    const exists = next.ledger.some(
      (entry) => entry.bookingId === booking.id && entry.entryKind === entryKind,
    );
    if (exists) continue;
    next.ledger.push({
      bookingId: booking.id,
      entryKind,
      amountGnf:
        entryKind === "driver_transport" ? booking.quote.driverAmountGnf : booking.quote.platformFeeGnf,
      currency: "GNF",
    });
  }
  return next;
}

export function replaceXlRate(
  store: XlStore,
  input: {
    actorId: string;
    axisId: string;
    expectedVersionId: string;
    frontSeatGnf: number;
    otherSeatGnf: number;
    nextVersionId: string;
    reason?: string | null;
    hasWritePermission: boolean;
  },
): { ok: true; store: XlStore } | { ok: false; error: string } {
  if (!input.hasWritePermission) return { ok: false, error: "xl_pricing_forbidden" };
  const axis = store.axes.find((item) => item.id === input.axisId);
  if (!axis) return { ok: false, error: "xl_route_not_configured" };
  if (axis.rate.versionId !== input.expectedVersionId) return { ok: false, error: "xl_rate_conflict" };
  if (!Number.isSafeInteger(input.frontSeatGnf) || input.frontSeatGnf < 0) {
    return { ok: false, error: "xl_rate_invalid" };
  }
  if (!Number.isSafeInteger(input.otherSeatGnf) || input.otherSeatGnf < 0) {
    return { ok: false, error: "xl_rate_invalid" };
  }
  const next = clone(store);
  const saved = next.axes.find((item) => item.id === axis.id);
  if (!saved) return { ok: false, error: "xl_route_not_configured" };
  const oldValue = { ...saved.rate };
  saved.rate = {
    versionId: input.nextVersionId,
    frontSeatGnf: input.frontSeatGnf,
    otherSeatGnf: input.otherSeatGnf,
    active: saved.rate.active,
  };
  next.audit.push({
    actorId: input.actorId,
    axisId: axis.id,
    action: "rate_changed",
    oldValue,
    newValue: saved.rate,
    reason: input.reason ?? null,
  });
  return { ok: true, store: next };
}

export function completeXlDeparture(
  store: XlStore,
  input: { departureId: string; actorUserId: string },
): { ok: true; store: XlStore } | { ok: false; error: string } {
  const departure = store.departures.find((item) => item.id === input.departureId);
  if (!departure) return { ok: false, error: "xl_departure_unavailable" };
  if (input.actorUserId !== departure.driverId) return { ok: false, error: "cash_forbidden" };
  if (departure.status === "canceled") return { ok: false, error: "ride_canceled" };
  const next = clone(store);
  const saved = next.departures.find((item) => item.id === departure.id);
  if (!saved) return { ok: false, error: "xl_departure_unavailable" };
  saved.status = "completed";
  for (const booking of next.bookings) {
    if (booking.departureId === saved.id && booking.status === "confirmed") booking.status = "completed";
  }
  return { ok: true, store: next };
}

export function collectXlCash(
  store: XlStore,
  input: { bookingId: string; actorUserId: string },
): { ok: true; store: XlStore; idempotent: boolean; totalGnf: number } | { ok: false; error: string } {
  const booking = store.bookings.find((item) => item.id === input.bookingId);
  if (!booking) return { ok: false, error: "ride_not_found" };
  if (input.actorUserId !== booking.driverId) return { ok: false, error: "cash_forbidden" };
  if (booking.status === "canceled") return { ok: false, error: "ride_canceled" };
  if (booking.status !== "completed") return { ok: false, error: "ride_not_completed" };
  if (booking.paymentMethod !== "cash" || booking.quote.currency !== "GNF") {
    return { ok: false, error: "currency_mismatch" };
  }
  if (booking.quote.countryCode !== "GN") return { ok: false, error: "market_mismatch" };
  if (booking.paymentStatus === "cash_collected") {
    return { ok: true, store: recordXlLedgerOnce(store, booking), idempotent: true, totalGnf: booking.quote.totalGnf };
  }
  const next = clone(store);
  const saved = next.bookings.find((item) => item.id === booking.id);
  if (!saved) return { ok: false, error: "ride_not_found" };
  saved.paymentStatus = "cash_collected";
  return {
    ok: true,
    store: recordXlLedgerOnce(next, saved),
    idempotent: false,
    totalGnf: saved.quote.totalGnf,
  };
}
