/**
 * Guinea XL interregional fares.
 * Prices, commission and baggage bands are data. This module only applies them.
 * Amounts are whole GNF. The client total is never an input.
 */

export const XL_COUNTRY_CODE = "GN";
export const XL_CURRENCY = "GNF";
export const XL_TIMEZONE = "Africa/Conakry";
export const XL_PASSENGER_CAPACITIES = [4, 5, 6, 7] as const;

export type XlPassengerCapacity = (typeof XL_PASSENGER_CAPACITIES)[number];
export type XlSeatRole = "front" | "other";

export type XlSeat = {
  index: number;
  role: XlSeatRole;
  bookingId: string | null;
};

export type XlRate = {
  versionId: string;
  frontSeatGnf: number;
  otherSeatGnf: number;
  active: boolean;
};

export type XlBaggageBand = {
  id: string;
  minKg: number;
  maxKg: number;
  priceGnf: number;
  active: boolean;
};

export type XlBaggageItem = {
  weightKg: unknown;
};

export type XlQuote = {
  frontSeatCount: number;
  otherSeatCount: number;
  passengerCount: number;
  frontSeatGnf: number;
  otherSeatGnf: number;
  transportGnf: number;
  baggageGnf: number;
  totalGnf: number;
  platformShareBps: number;
  platformFeeGnf: number;
  driverAmountGnf: number;
  currency: typeof XL_CURRENCY;
  countryCode: typeof XL_COUNTRY_CODE;
  rateVersionId: string;
  baggageLines: Array<{ weightKg: number; priceGnf: number; included: boolean }>;
};

export type XlFailure = { ok: false; error: string };

function fail(error: string): XlFailure {
  return { ok: false, error };
}

export function isSafeGnf(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function isXlCapacity(value: unknown): value is XlPassengerCapacity {
  return value === 4 || value === 5 || value === 6 || value === 7;
}

/** Passenger seats only. Index 1 is the single front seat. The driver is not a seat. */
export function buildXlSeats(capacity: XlPassengerCapacity): XlSeat[] {
  const seats: XlSeat[] = [];
  for (let index = 1; index <= capacity; index += 1) {
    seats.push({
      index,
      role: index === 1 ? "front" : "other",
      bookingId: null,
    });
  }
  return seats;
}

export function localityKey(label: unknown): string | null {
  const text = String(label ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "");
  return text || null;
}

/** Bidirectional axes share one key. Order does not matter unless the axis is directional. */
export function canonicalRouteKey(origin: string, destination: string): string {
  return [origin, destination].sort().join("|");
}

export function directionalRouteKey(origin: string, destination: string): string {
  return `${origin}|${destination}`;
}

export type XlAxisRecord = {
  id: string;
  originKey: string;
  destinationKey: string;
  routeKey: string;
  directional: boolean;
  active: boolean;
  rate: XlRate;
};

export function findActiveXlAxis(
  axes: XlAxisRecord[],
  originLabel: unknown,
  destinationLabel: unknown,
): XlAxisRecord | null {
  const origin = localityKey(originLabel);
  const destination = localityKey(destinationLabel);
  if (!origin || !destination || origin === destination) return null;
  const directed = directionalRouteKey(origin, destination);
  const directional = axes.find(
    (axis) => axis.active && axis.directional && axis.routeKey === directed,
  );
  if (directional) return directional;
  const shared = canonicalRouteKey(origin, destination);
  return (
    axes.find((axis) => axis.active && !axis.directional && axis.routeKey === shared) ?? null
  );
}

function addGnf(left: number, right: number): number | null {
  if (!isSafeGnf(left) || !isSafeGnf(right)) return null;
  const sum = left + right;
  return Number.isSafeInteger(sum) ? sum : null;
}

function mulGnf(price: number, count: number): number | null {
  if (!isSafeGnf(price) || !Number.isSafeInteger(count) || count < 0) return null;
  const product = price * count;
  return Number.isSafeInteger(product) ? product : null;
}

/** Half-up integer share. driver = total - platform, so the two parts always add up. */
export function splitTransportCommission(
  transportGnf: number,
  platformShareBps: number,
): { platformFeeGnf: number; driverAmountGnf: number } | null {
  if (!isSafeGnf(transportGnf)) return null;
  if (!Number.isSafeInteger(platformShareBps) || platformShareBps < 0 || platformShareBps > 10_000) {
    return null;
  }
  const product = transportGnf * platformShareBps;
  if (!Number.isSafeInteger(product)) return null;
  const platformFeeGnf = Math.floor((product + 5_000) / 10_000);
  return {
    platformFeeGnf,
    driverAmountGnf: transportGnf - platformFeeGnf,
  };
}

export function reserveXlSeats(
  seats: XlSeat[],
  seatIndexes: number[],
  bookingId: string,
): { ok: true; seats: XlSeat[] } | XlFailure {
  if (!Array.isArray(seatIndexes) || seatIndexes.length === 0) return fail("xl_seat_required");
  const unique = new Set(seatIndexes);
  if (unique.size !== seatIndexes.length) return fail("xl_seat_duplicate");
  const next = seats.map((seat) => ({ ...seat }));
  for (const index of seatIndexes) {
    if (!Number.isSafeInteger(index)) return fail("xl_seat_invalid");
    const seat = next.find((item) => item.index === index);
    if (!seat) return fail("xl_seat_invalid");
    if (seat.bookingId) return fail("xl_seat_taken");
  }
  for (const index of seatIndexes) {
    const seat = next.find((item) => item.index === index);
    if (seat) seat.bookingId = bookingId;
  }
  return { ok: true, seats: next };
}

function matchBand(weightKg: number, bands: XlBaggageBand[]): XlBaggageBand | null {
  const matches = bands.filter(
    (band) =>
      band.active &&
      isSafeGnf(band.priceGnf) &&
      Number.isSafeInteger(band.minKg) &&
      Number.isSafeInteger(band.maxKg) &&
      weightKg >= band.minKg &&
      weightKg <= band.maxKg,
  );
  if (matches.length !== 1) return null;
  return matches[0] ?? null;
}

export function priceXlBaggage(
  items: XlBaggageItem[],
  passengerCount: number,
  bands: XlBaggageBand[],
): { ok: true; baggageGnf: number; lines: XlQuote["baggageLines"] } | XlFailure {
  if (!Number.isSafeInteger(passengerCount) || passengerCount < 1) return fail("xl_seat_required");
  if (!Array.isArray(items)) return fail("xl_baggage_invalid");
  let baggageGnf = 0;
  let includedCount = 0;
  const lines: XlQuote["baggageLines"] = [];
  for (const item of items) {
    const weightKg = typeof item?.weightKg === "number" ? item.weightKg : Number.NaN;
    if (!Number.isFinite(weightKg) || !Number.isSafeInteger(weightKg) || weightKg <= 0) {
      return fail("xl_baggage_invalid");
    }
    const band = matchBand(weightKg, bands);
    if (!band) return fail("xl_baggage_not_accepted");
    if (band.priceGnf === 0) {
      includedCount += 1;
      if (includedCount > passengerCount) return fail("xl_backpack_limit");
    }
    const next = addGnf(baggageGnf, band.priceGnf);
    if (next == null) return fail("xl_amount_overflow");
    baggageGnf = next;
    lines.push({
      weightKg,
      priceGnf: band.priceGnf,
      included: band.priceGnf === 0,
    });
  }
  return { ok: true, baggageGnf, lines };
}

export function quoteXlReservation(input: {
  detectedCountryCodes: Array<string | null | undefined>;
  claimedCountryCode?: unknown;
  claimedCurrency?: unknown;
  claimedTotalGnf?: unknown;
  claimedBaggageGnf?: unknown;
  axis: XlAxisRecord | null;
  capacity: unknown;
  seatIndexes: number[];
  baggage: XlBaggageItem[];
  bands: XlBaggageBand[];
  platformShareBps: unknown;
}): { ok: true; quote: XlQuote } | XlFailure {
  const detected = input.detectedCountryCodes.map((code) =>
    String(code ?? "").trim().toUpperCase(),
  );
  if (detected.length === 0 || detected.some((code) => code !== XL_COUNTRY_CODE)) {
    return fail("market_mismatch");
  }
  const claimedCountry = String(input.claimedCountryCode ?? "").trim().toUpperCase();
  if (claimedCountry && claimedCountry !== XL_COUNTRY_CODE) return fail("market_mismatch");
  const claimedCurrency = String(input.claimedCurrency ?? "").trim().toUpperCase();
  if (claimedCurrency && claimedCurrency !== XL_CURRENCY) return fail("currency_mismatch");
  if (!input.axis || !input.axis.active || !input.axis.rate.active) return fail("xl_route_not_configured");
  if (!isXlCapacity(input.capacity)) return fail("xl_vehicle_capacity_unsupported");
  if (!isSafeGnf(input.axis.rate.frontSeatGnf) || !isSafeGnf(input.axis.rate.otherSeatGnf)) {
    return fail("xl_rate_invalid");
  }
  const platformShareBps = input.platformShareBps;
  if (
    typeof platformShareBps !== "number" ||
    !Number.isSafeInteger(platformShareBps) ||
    platformShareBps < 0 ||
    platformShareBps > 10_000
  ) {
    return fail("xl_commission_not_configured");
  }

  const reserved = reserveXlSeats(buildXlSeats(input.capacity), input.seatIndexes, "quote");
  if (reserved.ok === false) return reserved;
  const frontSeatCount = reserved.seats.filter((seat) => seat.bookingId && seat.role === "front").length;
  const otherSeatCount = reserved.seats.filter((seat) => seat.bookingId && seat.role === "other").length;
  const passengerCount = frontSeatCount + otherSeatCount;
  if (passengerCount > input.capacity) return fail("xl_capacity_exceeded");

  const frontTotal = mulGnf(input.axis.rate.frontSeatGnf, frontSeatCount);
  const otherTotal = mulGnf(input.axis.rate.otherSeatGnf, otherSeatCount);
  if (frontTotal == null || otherTotal == null) return fail("xl_amount_overflow");
  const transportGnf = addGnf(frontTotal, otherTotal);
  if (transportGnf == null) return fail("xl_amount_overflow");
  const split = splitTransportCommission(transportGnf, platformShareBps);
  if (!split) return fail("xl_commission_not_configured");
  const baggage = priceXlBaggage(input.baggage, passengerCount, input.bands);
  if (baggage.ok === false) return baggage;
  const totalGnf = addGnf(transportGnf, baggage.baggageGnf);
  if (totalGnf == null) return fail("xl_amount_overflow");

  if (isSafeGnf(input.claimedTotalGnf) && input.claimedTotalGnf !== totalGnf) {
    return fail("xl_client_total_rejected");
  }
  if (input.claimedTotalGnf != null && !isSafeGnf(input.claimedTotalGnf)) {
    return fail("xl_client_total_rejected");
  }
  if (isSafeGnf(input.claimedBaggageGnf) && input.claimedBaggageGnf !== baggage.baggageGnf) {
    return fail("xl_client_baggage_rejected");
  }
  if (input.claimedBaggageGnf != null && !isSafeGnf(input.claimedBaggageGnf)) {
    return fail("xl_client_baggage_rejected");
  }

  return {
    ok: true,
    quote: {
      frontSeatCount,
      otherSeatCount,
      passengerCount,
      frontSeatGnf: input.axis.rate.frontSeatGnf,
      otherSeatGnf: input.axis.rate.otherSeatGnf,
      transportGnf,
      baggageGnf: baggage.baggageGnf,
      totalGnf,
      platformShareBps,
      platformFeeGnf: split.platformFeeGnf,
      driverAmountGnf: split.driverAmountGnf,
      currency: XL_CURRENCY,
      countryCode: XL_COUNTRY_CODE,
      rateVersionId: input.axis.rate.versionId,
      baggageLines: baggage.lines,
    },
  };
}

export function bandsOverlap(bands: XlBaggageBand[]): boolean {
  const active = bands.filter((band) => band.active);
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length; j += 1) {
      const left = active[i];
      const right = active[j];
      if (!left || !right) continue;
      if (left.minKg <= right.maxKg && right.minKg <= left.maxKg) return true;
    }
  }
  return false;
}
