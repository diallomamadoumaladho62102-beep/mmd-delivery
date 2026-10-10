/**
 * Guinea XL segment fares.
 * The tariff card is data. This module does not store official distances.
 * A route total is the sum of each segment final. The minimum is not applied again.
 * Each reservation pays that route total once. The amount is not divided or multiplied by seat count.
 * Front and other seats stay distinct, with no seat supplement. Nothing here confirms a booking.
 */

import { splitTransportCommission } from "@/lib/markets/guineaXlPricing";
import { localityKey } from "@/lib/markets/guineaXlPricing";

/** Commercial segment bookings stay off until the migration is applied and distances are confirmed. */
export const XL_SEGMENT_COMMERCIAL_BOOKING_ENABLED = false;

export function segmentCommercialBookingEnabled(): boolean {
  return XL_SEGMENT_COMMERCIAL_BOOKING_ENABLED;
}

/** Segment trips exist only for Guinea and GNF. Another market is refused before any quote or booking. */
export function guineaXlSegmentMarketAllowed(body: {
  countryCode?: unknown;
  country_code?: unknown;
  currency?: unknown;
}): boolean {
  const country = String(body.countryCode ?? body.country_code ?? "").trim().toUpperCase();
  const currency = String(body.currency ?? "").trim().toUpperCase();
  if (country && country !== "GN") return false;
  if (currency && currency !== "GNF") return false;
  return true;
}

/** A detected pickup country other than Guinea closes the segment market. An unknown detection does not invent one. */
export function guineaXlSegmentMarketAllowedWithDetection(
  body: {
    countryCode?: unknown;
    country_code?: unknown;
    currency?: unknown;
  },
  detectedCountry: string | null,
): boolean {
  if (!guineaXlSegmentMarketAllowed(body)) return false;
  const detected = String(detectedCountry ?? "").trim().toUpperCase();
  if (detected && detected !== "GN") return false;
  return true;
}

export type XlSegmentBranch = "trunk" | "dougountounny" | "mali";

export type XlSegmentTariff = {
  version: number;
  baseGnf: number;
  perKmGnf: number;
  perMinuteGnf: number;
  minimumGnf: number;
};

export type XlSegmentInput = {
  code: string;
  originLabel: string;
  destinationLabel: string;
  distanceKm: number | null;
  durationMinutes: number | null;
  active: boolean;
  confirmed: boolean;
  sequence: number;
  branch: XlSegmentBranch;
  estimateSource?: string;
};

export type XlSegmentQuoteLine = {
  code: string;
  originLabel: string;
  destinationLabel: string;
  distanceKm: number;
  durationMinutes: number;
  rawGnf: number;
  finalGnf: number;
  minimumApplied: boolean;
};

export type XlSegmentFailure = { ok: false; error: string };

function fail(error: string): XlSegmentFailure {
  return { ok: false, error };
}

function wholeNonNegative(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

export function segmentSchemaMissing(message: string): boolean {
  return /guinea_xl_segment/i.test(message) && /does not exist|schema cache/i.test(message);
}

export function tariffFromRow(row: Record<string, unknown> | null): XlSegmentTariff | null {
  if (!row) return null;
  const tariff = {
    version: Number(row.version),
    baseGnf: Number(row.base_gnf),
    perKmGnf: Number(row.per_km_gnf),
    perMinuteGnf: Number(row.per_minute_gnf),
    minimumGnf: Number(row.minimum_gnf),
  };
  return isXlSegmentTariff(tariff) ? tariff : null;
}

export function segmentFromRow(row: Record<string, unknown>): XlSegmentInput & { id: string; version: number } {
  const branch = row.branch === "dougountounny" || row.branch === "mali" ? row.branch : "trunk";
  return {
    id: String(row.id),
    version: Number(row.version),
    code: String(row.code),
    originLabel: String(row.origin_label),
    destinationLabel: String(row.destination_label),
    distanceKm: row.distance_km == null ? null : Number(row.distance_km),
    durationMinutes: row.duration_minutes == null ? null : Number(row.duration_minutes),
    active: row.active === true,
    confirmed: row.confirmed === true,
    sequence: Number(row.sequence),
    branch,
    estimateSource: typeof row.estimate_source === "string" ? row.estimate_source : "",
  };
}

export function isXlSegmentTariff(value: unknown): value is XlSegmentTariff {
  if (!value || typeof value !== "object") return false;
  const tariff = value as XlSegmentTariff;
  return (
    Number.isSafeInteger(tariff.version) &&
    tariff.version > 0 &&
    wholeNonNegative(tariff.baseGnf) != null &&
    wholeNonNegative(tariff.perKmGnf) != null &&
    wholeNonNegative(tariff.perMinuteGnf) != null &&
    wholeNonNegative(tariff.minimumGnf) != null
  );
}

/** Whole kilometres above zero, or an empty field. */
export function parseSegmentDistanceKm(value: unknown): number | null | "invalid" {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) return "invalid";
  return value;
}

/** Whole minutes, zero included, or an empty field. */
export function parseSegmentDurationMinutes(value: unknown): number | null | "invalid" {
  if (value == null || value === "") return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return "invalid";
  return value;
}

export function parseSegmentPlaceLabel(value: unknown): string | "invalid" {
  if (typeof value !== "string") return "invalid";
  const label = value.trim();
  if (!label || label.length > 80 || !localityKey(label)) return "invalid";
  return label;
}

/** Source or verification note. Empty is allowed. The note is not a price. */
export function parseSegmentEstimateSource(value: unknown): string | "invalid" {
  if (value == null) return "";
  if (typeof value !== "string") return "invalid";
  const note = value.trim();
  if (note.length > 500) return "invalid";
  return note;
}

/**
 * The corridor stays a directed graph: one simple path between two places,
 * no cycle, and the two branches after a fork are never on the same path.
 */
export function validateXlSegmentGraph(segments: XlSegmentInput[]): { ok: true } | XlSegmentFailure {
  type Edge = { from: string; to: string; branch: XlSegmentInput["branch"] };
  const outgoing = new Map<string, Edge[]>();
  const seenEdge = new Set<string>();
  const nodes = new Set<string>();
  for (const segment of segments) {
    const from = localityKey(segment.originLabel);
    const to = localityKey(segment.destinationLabel);
    if (!from || !to || from === to) return fail("xl_segment_path_invalid");
    const edgeKey = `${from}>${to}`;
    if (seenEdge.has(edgeKey)) return fail("xl_segment_path_invalid");
    seenEdge.add(edgeKey);
    nodes.add(from);
    nodes.add(to);
    const list = outgoing.get(from) ?? [];
    list.push({ from, to, branch: segment.branch });
    outgoing.set(from, list);
  }
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (node: string): boolean => {
    const mark = state.get(node) ?? 0;
    if (mark === 1) return true;
    if (mark === 2) return false;
    state.set(node, 1);
    for (const edge of outgoing.get(node) ?? []) {
      if (visit(edge.to)) return true;
    }
    state.set(node, 2);
    return false;
  };
  for (const node of nodes) {
    if (visit(node)) return fail("xl_segment_path_invalid");
  }
  for (const origin of nodes) {
    for (const destination of nodes) {
      if (origin === destination) continue;
      let count = 0;
      let exclusive = true;
      const walk = (node: string, seen: Set<string>, branches: Set<string>) => {
        if (count > 1) return;
        if (node === destination) {
          count += 1;
          if (branches.size > 1) exclusive = false;
          return;
        }
        for (const edge of outgoing.get(node) ?? []) {
          if (seen.has(edge.to)) continue;
          const nextSeen = new Set(seen);
          nextSeen.add(edge.to);
          const nextBranches = new Set(branches);
          if (edge.branch !== "trunk") nextBranches.add(edge.branch);
          walk(edge.to, nextSeen, nextBranches);
        }
      };
      walk(origin, new Set([origin]), new Set());
      if (count > 1 || !exclusive) return fail("xl_segment_path_invalid");
    }
  }
  return { ok: true };
}

export function segmentCanBeActivated(distanceKm: unknown, durationMinutes: unknown): boolean {
  return parseSegmentDistanceKm(distanceKm) !== "invalid" &&
    parseSegmentDistanceKm(distanceKm) != null &&
    parseSegmentDurationMinutes(durationMinutes) !== "invalid" &&
    parseSegmentDurationMinutes(durationMinutes) != null;
}

export function priceXlSegment(input: {
  distanceKm: unknown;
  durationMinutes: unknown;
  tariff: XlSegmentTariff;
}): { ok: true; rawGnf: number; finalGnf: number; minimumApplied: boolean } | XlSegmentFailure {
  if (!isXlSegmentTariff(input.tariff)) return fail("xl_segment_not_priced");
  const distanceKm = parseSegmentDistanceKm(input.distanceKm);
  const durationMinutes = parseSegmentDurationMinutes(input.durationMinutes);
  if (distanceKm === "invalid" || distanceKm == null || durationMinutes === "invalid" || durationMinutes == null) {
    return fail("xl_segment_not_priced");
  }
  const distanceComponent = distanceKm * input.tariff.perKmGnf;
  const timeComponent = durationMinutes * input.tariff.perMinuteGnf;
  if (!Number.isSafeInteger(distanceComponent) || !Number.isSafeInteger(timeComponent)) {
    return fail("xl_segment_not_priced");
  }
  const rawGnf = input.tariff.baseGnf + distanceComponent + timeComponent;
  if (!Number.isSafeInteger(rawGnf)) return fail("xl_segment_not_priced");
  const finalGnf = rawGnf < input.tariff.minimumGnf ? input.tariff.minimumGnf : rawGnf;
  return { ok: true, rawGnf, finalGnf, minimumApplied: finalGnf !== rawGnf };
}

export function findXlSegmentPath(
  segments: XlSegmentInput[],
  originLabel: unknown,
  destinationLabel: unknown,
): { ok: true; segments: XlSegmentInput[] } | XlSegmentFailure {
  const origin = localityKey(originLabel);
  const destination = localityKey(destinationLabel);
  if (!origin || !destination || origin === destination) return fail("xl_segment_path_invalid");
  const outgoing = new Map<string, XlSegmentInput[]>();
  for (const segment of segments) {
    const from = localityKey(segment.originLabel);
    const to = localityKey(segment.destinationLabel);
    if (!from || !to || from === to) return fail("xl_segment_path_invalid");
    const list = outgoing.get(from) ?? [];
    list.push(segment);
    outgoing.set(from, list);
  }

  const paths: XlSegmentInput[][] = [];
  const walk = (node: string, trail: XlSegmentInput[], seen: Set<string>) => {
    if (paths.length > 1) return;
    if (node === destination) {
      paths.push(trail);
      return;
    }
    for (const segment of outgoing.get(node) ?? []) {
      const next = localityKey(segment.destinationLabel);
      if (!next || seen.has(next)) continue;
      const nextSeen = new Set(seen);
      nextSeen.add(next);
      walk(next, [...trail, segment], nextSeen);
    }
  };
  walk(origin, [], new Set([origin]));
  if (paths.length !== 1) return fail("xl_segment_path_invalid");
  return { ok: true, segments: paths[0] ?? [] };
}

export function quoteXlSegmentRoute(input: {
  segments: XlSegmentInput[];
  originLabel: unknown;
  destinationLabel: unknown;
  tariff: XlSegmentTariff;
  mode: "preview" | "local" | "definitive";
  claimedTotalGnf?: unknown;
}):
  | {
      ok: true;
      definitive: boolean;
      totalGnf: number;
      rawTotalGnf: number;
      segments: XlSegmentQuoteLine[];
    }
  | XlSegmentFailure {
  const path = findXlSegmentPath(input.segments, input.originLabel, input.destinationLabel);
  if (path.ok === false) return path;
  const lines: XlSegmentQuoteLine[] = [];
  let totalGnf = 0;
  let rawTotalGnf = 0;
  let definitive = true;
  for (const segment of path.segments) {
    const priced = priceXlSegment({
      distanceKm: segment.distanceKm,
      durationMinutes: segment.durationMinutes,
      tariff: input.tariff,
    });
    if (priced.ok === false) return fail("xl_segment_not_priced");
    if (!segment.active) {
      if (input.mode === "definitive" || input.mode === "local") return fail("xl_segment_inactive");
      definitive = false;
    }
    if (!segment.confirmed) {
      if (input.mode === "definitive") return fail("xl_segment_unconfirmed");
      definitive = false;
    }
    if (!Number.isSafeInteger(totalGnf + priced.finalGnf) || !Number.isSafeInteger(rawTotalGnf + priced.rawGnf)) {
      return fail("xl_segment_not_priced");
    }
    totalGnf += priced.finalGnf;
    rawTotalGnf += priced.rawGnf;
    lines.push({
      code: segment.code,
      originLabel: segment.originLabel,
      destinationLabel: segment.destinationLabel,
      distanceKm: segment.distanceKm ?? 0,
      durationMinutes: segment.durationMinutes ?? 0,
      rawGnf: priced.rawGnf,
      finalGnf: priced.finalGnf,
      minimumApplied: priced.minimumApplied,
    });
  }
  if (input.claimedTotalGnf != null) {
    if (typeof input.claimedTotalGnf !== "number" || input.claimedTotalGnf !== totalGnf) {
      return fail("xl_client_total_rejected");
    }
  }
  return { ok: true, definitive, totalGnf, rawTotalGnf, segments: lines };
}

export const XL_SEGMENT_ADMIN_ROUTES: Array<[string, string]> = [
  ["Conakry", "Kindia"],
  ["Kindia", "Mamou"],
  ["Conakry", "Mamou"],
  ["Mamou", "Dalaba"],
  ["Dalaba", "Pita"],
  ["Pita", "Labé"],
  ["Mamou", "Labé"],
  ["Conakry", "Pita"],
  ["Conakry", "Labé"],
  ["Conakry", "Yembering"],
  ["Conakry", "Dougountounny"],
  ["Conakry", "Mali Centre"],
  ["Labé", "Yembering"],
  ["Labé", "Dougountounny"],
  ["Labé", "Mali Centre"],
  ["Yembering", "Dougountounny"],
  ["Yembering", "Mali Centre"],
];

/** Routes that exist on the stored graph, including the reference corridor when those labels still connect. */
export function xlSegmentAdminRouteLabels(segments: XlSegmentInput[]): Array<[string, string]> {
  const pairs = new Map<string, [string, string]>();
  const remember = (originLabel: string, destinationLabel: string) => {
    const origin = localityKey(originLabel);
    const destination = localityKey(destinationLabel);
    if (!origin || !destination || origin === destination) return;
    if (findXlSegmentPath(segments, originLabel, destinationLabel).ok === false) return;
    const key = `${origin}>${destination}`;
    if (!pairs.has(key)) pairs.set(key, [originLabel, destinationLabel]);
  };
  for (const [origin, destination] of XL_SEGMENT_ADMIN_ROUTES) remember(origin, destination);
  const labels = new Map<string, string>();
  for (const segment of [...segments].sort((left, right) => left.sequence - right.sequence)) {
    const origin = localityKey(segment.originLabel);
    const destination = localityKey(segment.destinationLabel);
    if (origin && !labels.has(origin)) labels.set(origin, segment.originLabel);
    if (destination && !labels.has(destination)) labels.set(destination, segment.destinationLabel);
  }
  for (const origin of labels.values()) {
    for (const destination of labels.values()) remember(origin, destination);
  }
  return [...pairs.values()];
}

export function buildXlSegmentAdminView<T extends XlSegmentInput>(segments: T[], tariff: XlSegmentTariff | null) {
  const decorated = segments.map((segment) => {
    const priced = tariff
      ? priceXlSegment({
          distanceKm: segment.distanceKm,
          durationMinutes: segment.durationMinutes,
          tariff,
        })
      : fail("xl_segment_not_priced");
    return {
      ...segment,
      rawGnf: priced.ok ? priced.rawGnf : null,
      finalGnf: priced.ok ? priced.finalGnf : null,
      priceable: priced.ok === true,
    };
  });
  const routes = xlSegmentAdminRouteLabels(segments).map(([originLabel, destinationLabel]) => {
    if (!tariff) {
      return {
        originLabel,
        destinationLabel,
        segmentCodes: [],
        totalGnf: null,
        rawTotalGnf: null,
        definitive: false,
        error: "xl_segment_not_priced",
      };
    }
    const quote = quoteXlSegmentRoute({
      segments,
      originLabel,
      destinationLabel,
      tariff,
      mode: "preview",
    });
    if (quote.ok === false) {
      return {
        originLabel,
        destinationLabel,
        segmentCodes: [],
        totalGnf: null,
        rawTotalGnf: null,
        definitive: false,
        error: quote.error,
      };
    }
    return {
      originLabel,
      destinationLabel,
      segmentCodes: quote.segments.map((segment) => segment.code),
      totalGnf: quote.totalGnf,
      rawTotalGnf: quote.rawTotalGnf,
      definitive: quote.definitive,
      error: null as string | null,
    };
  });
  return { segments: decorated, routes };
}

export type XlPassengerFare = {
  seatPricing: "per_passenger";
  seatIndex: number;
  seatRole: "front" | "other";
  seatSupplementGnf: 0;
  passengerCount: 1;
  routeTransportGnf: number;
  transportGnf: number;
  definitive: boolean;
  segments: XlSegmentQuoteLine[];
};

/** One reservation, one passenger, the full route price. Seat role does not change the amount. */
export function quoteXlPassengerFare(input: {
  segments: XlSegmentInput[];
  originLabel: unknown;
  destinationLabel: unknown;
  tariff: XlSegmentTariff;
  seatIndex: unknown;
  passengerCount?: unknown;
  seatCount?: unknown;
  claimedTransportGnf?: unknown;
  mode?: "local" | "definitive";
}): { ok: true; fare: XlPassengerFare } | XlSegmentFailure {
  if (input.passengerCount != null && input.passengerCount !== 1) return fail("xl_one_passenger_per_reservation");
  if (input.seatCount != null && input.seatCount !== 1) return fail("xl_one_passenger_per_reservation");
  if (typeof input.seatIndex !== "number" || !Number.isSafeInteger(input.seatIndex) || input.seatIndex < 1 || input.seatIndex > 7) {
    return fail("xl_seat_invalid");
  }
  const quote = quoteXlSegmentRoute({
    segments: input.segments,
    originLabel: input.originLabel,
    destinationLabel: input.destinationLabel,
    tariff: input.tariff,
    mode: input.mode ?? "definitive",
  });
  if (quote.ok === false) return quote;
  if (input.claimedTransportGnf != null && input.claimedTransportGnf !== quote.totalGnf) {
    return fail("xl_client_total_rejected");
  }
  return {
    ok: true,
    fare: {
      seatPricing: "per_passenger",
      seatIndex: input.seatIndex,
      seatRole: input.seatIndex === 1 ? "front" : "other",
      seatSupplementGnf: 0,
      passengerCount: 1,
      routeTransportGnf: quote.totalGnf,
      transportGnf: quote.totalGnf,
      definitive: quote.definitive,
      segments: quote.segments.map((segment) => ({ ...segment })),
    },
  };
}

export type XlSegmentSnapshot = {
  fareSource: "xl_segment";
  seatPricing: "per_passenger";
  seatIndex: number;
  seatRole: "front" | "other";
  seatSupplementGnf: 0;
  passengerCount: 1;
  commercialBooking: false;
  tariffVersion: number;
  baseGnf: number;
  perKmGnf: number;
  perMinuteGnf: number;
  minimumGnf: number;
  segments: XlSegmentQuoteLine[];
  routeTransportGnf: number;
  transportGnf: number;
  baggageGnf: number;
  totalGnf: number;
  platformShareBps: number;
  platformFeeGnf: number;
  driverAmountGnf: number;
};

/** Records one passenger's accepted route price. It does not confirm a commercial booking. */
export function buildXlSegmentPriceSnapshot(input: {
  fare: XlPassengerFare;
  tariff: XlSegmentTariff;
  platformShareBps: unknown;
  baggageGnf: unknown;
}): { ok: true; snapshot: XlSegmentSnapshot } | XlSegmentFailure {
  if (input.fare.passengerCount !== 1 || input.fare.transportGnf !== input.fare.routeTransportGnf) {
    return fail("xl_one_passenger_per_reservation");
  }
  if (typeof input.platformShareBps !== "number") return fail("xl_commission_not_configured");
  if (typeof input.baggageGnf !== "number" || !Number.isSafeInteger(input.baggageGnf) || input.baggageGnf < 0) {
    return fail("xl_baggage_invalid");
  }
  const split = splitTransportCommission(input.fare.transportGnf, input.platformShareBps);
  if (!split) return fail("xl_commission_not_configured");
  const totalGnf = input.fare.transportGnf + input.baggageGnf;
  if (!Number.isSafeInteger(totalGnf)) return fail("xl_segment_not_priced");
  return {
    ok: true,
    snapshot: {
      fareSource: "xl_segment",
      seatPricing: "per_passenger",
      seatIndex: input.fare.seatIndex,
      seatRole: input.fare.seatRole,
      seatSupplementGnf: 0,
      passengerCount: 1,
      commercialBooking: false,
      tariffVersion: input.tariff.version,
      baseGnf: input.tariff.baseGnf,
      perKmGnf: input.tariff.perKmGnf,
      perMinuteGnf: input.tariff.perMinuteGnf,
      minimumGnf: input.tariff.minimumGnf,
      segments: input.fare.segments.map((segment) => ({ ...segment })),
      routeTransportGnf: input.fare.routeTransportGnf,
      transportGnf: input.fare.transportGnf,
      baggageGnf: input.baggageGnf,
      totalGnf,
      platformShareBps: input.platformShareBps,
      platformFeeGnf: split.platformFeeGnf,
      driverAmountGnf: split.driverAmountGnf,
    },
  };
}

export type XlSegmentHold = {
  id: string;
  idempotencyKey: string;
  clientUserId: string;
  departureId: string;
  seatIndex: number;
  segmentCodes: string[];
  seatRole: "front" | "other";
  seatSupplementGnf: 0;
  seatPricing: "per_passenger";
  passengerCount: 1;
  transportGnf: number;
  commercialBooking: false;
};

export type XlSegmentHoldStore = { holds: XlSegmentHold[] };

export function segmentCodesOverlap(left: string[], right: string[]): boolean {
  const codes = new Set(left);
  return right.some((code) => codes.has(code));
}

export type XlSegmentCommercialPlan = {
  commercialBooking: false;
  idempotencyKey: string;
  seatIndex: number;
  fare: XlPassengerFare;
  snapshot: XlSegmentSnapshot;
};

/**
 * Builds the server-side plan for one passenger.
 * It does not write a booking. Commercial confirmation stays disabled.
 */
export function planXlSegmentCommercialBooking(input: {
  idempotencyKey: unknown;
  segments: XlSegmentInput[];
  originLabel: unknown;
  destinationLabel: unknown;
  tariff: XlSegmentTariff;
  seatIndex: unknown;
  passengerCount?: unknown;
  seatCount?: unknown;
  claimedTransportGnf?: unknown;
  platformShareBps: unknown;
  baggageGnf: unknown;
}): { ok: true; plan: XlSegmentCommercialPlan } | XlSegmentFailure {
  const idempotencyKey = String(input.idempotencyKey ?? "").trim();
  if (!idempotencyKey || idempotencyKey.length > 80) return fail("xl_booking_invalid");
  const fare = quoteXlPassengerFare({
    segments: input.segments,
    originLabel: input.originLabel,
    destinationLabel: input.destinationLabel,
    tariff: input.tariff,
    seatIndex: input.seatIndex,
    passengerCount: input.passengerCount ?? 1,
    seatCount: input.seatCount ?? 1,
    claimedTransportGnf: input.claimedTransportGnf,
  });
  if (fare.ok === false) return fare;
  const snapshot = buildXlSegmentPriceSnapshot({
    fare: fare.fare,
    tariff: input.tariff,
    platformShareBps: input.platformShareBps,
    baggageGnf: input.baggageGnf,
  });
  if (snapshot.ok === false) return snapshot;
  return {
    ok: true,
    plan: {
      commercialBooking: false,
      idempotencyKey,
      seatIndex: fare.fare.seatIndex,
      fare: fare.fare,
      snapshot: snapshot.snapshot,
    },
  };
}

/** Refuses every commercial segment booking. A valid plan is not a reservation. */
export function requestXlSegmentCommercialBooking(): { ok: false; error: "xl_segment_commercial_disabled" } {
  const error = "xl_segment_commercial_disabled" as const;
  if (XL_SEGMENT_COMMERCIAL_BOOKING_ENABLED) return { ok: false, error };
  return { ok: false, error };
}

/**
 * Plans a seat hold on the segments of one route.
 * This is not a commercial booking and does not divide or multiply the route price.
 */
export function planXlSegmentSeatHold(
  store: XlSegmentHoldStore,
  input: {
    id: string;
    idempotencyKey: string;
    clientUserId: string;
    departureId: string;
    seatIndex: number;
    segments: XlSegmentInput[];
    originLabel: unknown;
    destinationLabel: unknown;
    tariff: XlSegmentTariff;
  },
): { ok: true; store: XlSegmentHoldStore; hold: XlSegmentHold; idempotent: boolean } | XlSegmentFailure {
  const existing = store.holds.find(
    (hold) => hold.clientUserId === input.clientUserId && hold.idempotencyKey === input.idempotencyKey,
  );
  if (existing) return { ok: true, store, hold: existing, idempotent: true };
  const fare = quoteXlPassengerFare({
    segments: input.segments,
    originLabel: input.originLabel,
    destinationLabel: input.destinationLabel,
    tariff: input.tariff,
    seatIndex: input.seatIndex,
    passengerCount: 1,
    seatCount: 1,
  });
  if (fare.ok === false) return fare;
  const segmentCodes = fare.fare.segments.map((segment) => segment.code);
  const taken = store.holds.some(
    (hold) =>
      hold.departureId === input.departureId &&
      hold.seatIndex === input.seatIndex &&
      segmentCodesOverlap(hold.segmentCodes, segmentCodes),
  );
  if (taken) return fail("xl_seat_taken");
  const hold: XlSegmentHold = {
    id: input.id,
    idempotencyKey: input.idempotencyKey,
    clientUserId: input.clientUserId,
    departureId: input.departureId,
    seatIndex: input.seatIndex,
    segmentCodes,
    seatRole: fare.fare.seatRole,
    seatSupplementGnf: 0,
    seatPricing: "per_passenger",
    passengerCount: 1,
    transportGnf: fare.fare.transportGnf,
    commercialBooking: false,
  };
  return { ok: true, store: { holds: [...store.holds, hold] }, hold, idempotent: false };
}
