/**
 * Matches one XL passenger to an open driver departure.
 * The driver must already cover the requested segments, in that direction.
 * A road measurement is required. A straight line is not a ranking.
 * Missing dispatch limits stay missing. This module does not confirm a booking.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { findXlSegmentPath, segmentFromRow, type XlSegmentInput } from "@/lib/markets/guineaXlSegments";
import {
  establishXlSegmentProgress,
  type XlProgressEvent,
  type XlProgressStatus,
} from "../../../../../shared/xlSegmentProgress";
import { xlProgressEventFromStoredRow } from "../../../../../shared/xlProgressWire";

export type XlDispatchLimits = {
  maxPickupMeters: number;
  maxDetourMeters: number;
  maxPickupDelayMinutes: number;
  maxLocationAgeMs: number;
};

export type XlDispatchRoad = {
  distanceMeters: number;
  etaMinutes: number;
};

export type XlDispatchHold = {
  seatIndex: number;
  segmentCodes: string[];
  /** An axis booking occupies the whole seat, on every segment. */
  blocksSeat: boolean;
};

export type XlDispatchSegment = {
  code: string;
  branch: XlSegmentInput["branch"];
  distanceKm: number | null;
  durationMinutes: number | null;
};

export type XlDispatchDeparture = {
  id: string;
  driverId: string;
  status: "open" | "closed" | "canceled" | "completed";
  driverAvailable: boolean;
  capacity: number;
  scheduledAtMs: number | null;
  segments: XlDispatchSegment[];
  /** before/at are verified. after has passed the pickup. unverified is not assigned. */
  progress: XlProgressStatus;
  passedSegmentCodes: string[];
  holds: XlDispatchHold[];
  locationUpdatedAtMs: number | null;
  road: XlDispatchRoad | null;
};

export type XlDispatchRejection = {
  departureId: string;
  reason: string;
};

export type XlDispatchChoice = {
  ok: true;
  departureId: string;
  driverId: string;
  seatIndex: number;
  segmentCodes: string[];
  distanceMeters: number;
  etaMinutes: number;
  commercialBooking: false;
};

export type XlDispatchFailure = {
  ok: false;
  error: string;
  rejected: XlDispatchRejection[];
};

function fail(error: string, rejected: XlDispatchRejection[] = []): XlDispatchFailure {
  return { ok: false, error, rejected };
}

/** The driver's run, expanded to the stored segment path. No axis is created. */
export function planXlSegmentDeparture(
  segments: XlSegmentInput[],
  originLabel: unknown,
  destinationLabel: unknown,
): { ok: true; segmentCodes: string[]; axisId: null } | { ok: false; error: string } {
  const path = findXlSegmentPath(segments, originLabel, destinationLabel);
  if (path.ok === false) return path;
  if (path.segments.some((segment) => !segment.active)) return { ok: false, error: "xl_segment_inactive" };
  return { ok: true, segmentCodes: path.segments.map((segment) => segment.code), axisId: null };
}

export function dispatchLimitsFromRow(row: Record<string, unknown> | null): XlDispatchLimits | null {
  if (!row) return null;
  const maxPickupMeters = whole(row.max_pickup_meters);
  const maxDetourMeters = whole(row.max_detour_meters);
  const maxPickupDelayMinutes = whole(row.max_pickup_delay_minutes);
  const maxLocationAgeSeconds = whole(row.max_location_age_seconds);
  if (
    maxPickupMeters == null ||
    maxDetourMeters == null ||
    maxPickupDelayMinutes == null ||
    maxLocationAgeSeconds == null
  ) {
    return null;
  }
  return {
    maxPickupMeters,
    maxDetourMeters,
    maxPickupDelayMinutes,
    maxLocationAgeMs: maxLocationAgeSeconds * 1000,
  };
}

/** Blank and missing values stay missing. Zero is accepted only when it was sent as zero. */
export function parseDispatchLimitInput(body: Record<string, unknown>):
  | {
      ok: true;
      maxPickupMeters: number;
      maxDetourMeters: number;
      maxPickupDelayMinutes: number;
      maxLocationAgeSeconds: number;
    }
  | { ok: false; error: "xl_dispatch_not_configured" } {
  const maxPickupMeters = requiredWhole(body.maxPickupMeters);
  const maxDetourMeters = requiredWhole(body.maxDetourMeters);
  const maxPickupDelayMinutes = requiredWhole(body.maxPickupDelayMinutes);
  const maxLocationAgeSeconds = requiredWhole(body.maxLocationAgeSeconds);
  if (
    maxPickupMeters == null ||
    maxDetourMeters == null ||
    maxPickupDelayMinutes == null ||
    maxLocationAgeSeconds == null
  ) {
    return { ok: false, error: "xl_dispatch_not_configured" };
  }
  return { ok: true, maxPickupMeters, maxDetourMeters, maxPickupDelayMinutes, maxLocationAgeSeconds };
}

export function interpretDispatchLimitSave(input: {
  errorMessage: string | null;
  row: Record<string, unknown> | null;
}): { ok: true; limits: XlDispatchLimits } | { ok: false; error: string } {
  if (input.errorMessage) {
    if (/max_pickup_meters|schema cache|does not exist/i.test(input.errorMessage)) {
      return { ok: false, error: "xl_dispatch_not_configured" };
    }
    return { ok: false, error: "xl_catalog_failed" };
  }
  if (!input.row) return { ok: false, error: "xl_segment_conflict" };
  const limits = dispatchLimitsFromRow(input.row);
  if (!limits) return { ok: false, error: "xl_dispatch_not_configured" };
  return { ok: true, limits };
}

function requiredWhole(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  return whole(typeof value === "number" ? value : Number(value));
}

function whole(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

export function seatFreeOnSegmentPath(holds: XlDispatchHold[], seatIndex: number, segmentCodes: string[]): boolean {
  for (const hold of holds) {
    if (hold.seatIndex !== seatIndex) continue;
    if (hold.blocksSeat) return false;
    if (hold.segmentCodes.some((code) => segmentCodes.includes(code))) return false;
  }
  return true;
}

export function freeSeatsOnSegmentPath(input: {
  capacity: number;
  holds: XlDispatchHold[];
  segmentCodes: string[];
}): number[] {
  const seats: number[] = [];
  const capacity = Math.min(Math.max(Math.trunc(input.capacity), 0), 7);
  for (let seatIndex = 1; seatIndex <= capacity; seatIndex += 1) {
    if (seatFreeOnSegmentPath(input.holds, seatIndex, input.segmentCodes)) seats.push(seatIndex);
  }
  return seats;
}

function coversInOrder(departureCodes: string[], requestedCodes: string[]): boolean {
  if (requestedCodes.length === 0 || requestedCodes.length > departureCodes.length) return false;
  for (let start = 0; start <= departureCodes.length - requestedCodes.length; start += 1) {
    const same = requestedCodes.every((code, offset) => departureCodes[start + offset] === code);
    if (same) return true;
  }
  return false;
}

function branchesExclusive(segments: XlDispatchSegment[]): boolean {
  const branches = new Set(segments.map((segment) => segment.branch).filter((branch) => branch !== "trunk"));
  return branches.size <= 1;
}

function corridorMetersToPickup(departure: XlDispatchDeparture, requestedCodes: string[]): number | null {
  const pickupCode = requestedCodes[0];
  const pickupAt = departure.segments.findIndex((segment) => segment.code === pickupCode);
  if (pickupAt < 0) return null;
  let meters = 0;
  for (let index = 0; index < pickupAt; index += 1) {
    const segment = departure.segments[index];
    if (!segment || departure.passedSegmentCodes.includes(segment.code)) continue;
    if (segment.distanceKm == null || !Number.isSafeInteger(segment.distanceKm) || segment.distanceKm <= 0) return null;
    const next = meters + segment.distanceKm * 1000;
    if (!Number.isSafeInteger(next)) return null;
    meters = next;
  }
  return meters;
}

function scheduleArrivalMs(departure: XlDispatchDeparture, requestedCodes: string[]): number | null {
  if (departure.scheduledAtMs == null) return null;
  const pickupCode = requestedCodes[0];
  const pickupAt = departure.segments.findIndex((segment) => segment.code === pickupCode);
  if (pickupAt < 0) return null;
  let minutes = 0;
  for (let index = 0; index < pickupAt; index += 1) {
    const segment = departure.segments[index];
    if (!segment || departure.passedSegmentCodes.includes(segment.code)) continue;
    if (segment.durationMinutes == null || !Number.isSafeInteger(segment.durationMinutes) || segment.durationMinutes < 0) {
      return null;
    }
    minutes += segment.durationMinutes;
  }
  return departure.scheduledAtMs + minutes * 60_000;
}

/** Route, seat, and status checks that do not look at a position. */
export function xlDepartureRouteRejection(
  departure: XlDispatchDeparture,
  requestedCodes: string[],
): string | null {
  if (departure.status === "completed") return "xl_departure_completed";
  if (departure.status === "canceled") return "xl_departure_canceled";
  if (departure.status !== "open" || !departure.driverAvailable) return "xl_driver_unavailable";
  if (!branchesExclusive(departure.segments)) return "xl_driver_wrong_direction";
  const codes = departure.segments.map((segment) => segment.code);
  if (!coversInOrder(codes, requestedCodes)) return "xl_driver_wrong_direction";
  if (requestedCodes.some((code) => departure.passedSegmentCodes.includes(code))) return "xl_pickup_passed";
  const seats = freeSeatsOnSegmentPath({
    capacity: departure.capacity,
    holds: departure.holds,
    segmentCodes: requestedCodes,
  });
  if (seats.length === 0) return "xl_seat_taken";
  const corridor = corridorMetersToPickup(departure, requestedCodes);
  if (corridor == null) return "xl_segment_not_priced";
  return null;
}

function rejectDeparture(
  departure: XlDispatchDeparture,
  requestedCodes: string[],
  limits: XlDispatchLimits,
  requestedPickupAtMs: number,
  nowMs: number,
): string | null {
  if (departure.progress === "unverified") return "xl_progress_unverified";
  if (departure.progress === "inconsistent") return "xl_progress_inconsistent";
  if (departure.progress === "after") return "xl_pickup_passed";
  const routeRejection = xlDepartureRouteRejection(departure, requestedCodes);
  if (routeRejection) return routeRejection;
  const locationFresh =
    departure.locationUpdatedAtMs != null && nowMs - departure.locationUpdatedAtMs <= limits.maxLocationAgeMs;
  if (!locationFresh || departure.road == null) return "xl_driver_location_unavailable";
  if (!Number.isFinite(departure.road.distanceMeters) || !Number.isFinite(departure.road.etaMinutes)) {
    return "xl_driver_location_unavailable";
  }
  if (departure.road.distanceMeters > limits.maxPickupMeters) return "xl_driver_too_far";
  const corridor = corridorMetersToPickup(departure, requestedCodes);
  if (corridor == null) return "xl_segment_not_priced";
  if (departure.road.distanceMeters > corridor + limits.maxDetourMeters) return "xl_detour_exceeded";
  const roadArrival = nowMs + departure.road.etaMinutes * 60_000;
  const scheduleArrival = scheduleArrivalMs(departure, requestedCodes);
  const latest = requestedPickupAtMs + limits.maxPickupDelayMinutes * 60_000;
  if (roadArrival > latest) return "xl_pickup_delay";
  if (scheduleArrival != null && scheduleArrival > latest) return "xl_pickup_delay";
  return null;
}

/**
 * Chooses one open departure and one free seat.
 * The same snapshot can select the same last seat twice. PostgreSQL is the lock.
 */
export function selectXlSegmentDriver(input: {
  segments: XlSegmentInput[];
  originLabel: unknown;
  destinationLabel: unknown;
  requestedPickupAtMs: number;
  nowMs: number;
  limits: XlDispatchLimits | null;
  departures: XlDispatchDeparture[];
  excludeDepartureIds?: string[];
}): XlDispatchChoice | XlDispatchFailure {
  if (
    !input.limits ||
    !Number.isSafeInteger(input.requestedPickupAtMs) ||
    !Number.isSafeInteger(input.nowMs)
  ) {
    return fail("xl_dispatch_not_configured");
  }
  const path = findXlSegmentPath(input.segments, input.originLabel, input.destinationLabel);
  if (path.ok === false) return fail(path.error);
  if (path.segments.some((segment) => !segment.active)) return fail("xl_segment_inactive");
  const requestedCodes = path.segments.map((segment) => segment.code);
  const rejected: XlDispatchRejection[] = [];
  const admissible: Array<XlDispatchDeparture & { seatIndex: number }> = [];
  const excluded = new Set(input.excludeDepartureIds ?? []);
  for (const departure of input.departures) {
    if (excluded.has(departure.id)) continue;
    const reason = rejectDeparture(departure, requestedCodes, input.limits, input.requestedPickupAtMs, input.nowMs);
    if (reason) {
      rejected.push({ departureId: departure.id, reason });
      continue;
    }
    const seatIndex = freeSeatsOnSegmentPath({
      capacity: departure.capacity,
      holds: departure.holds,
      segmentCodes: requestedCodes,
    })[0];
    if (seatIndex == null || departure.road == null) {
      rejected.push({ departureId: departure.id, reason: "xl_seat_taken" });
      continue;
    }
    admissible.push({ ...departure, seatIndex });
  }
  admissible.sort((left, right) => {
    const eta = (left.road?.etaMinutes ?? 0) - (right.road?.etaMinutes ?? 0);
    if (eta !== 0) return eta;
    const distance = (left.road?.distanceMeters ?? 0) - (right.road?.distanceMeters ?? 0);
    if (distance !== 0) return distance;
    return left.id < right.id ? -1 : 1;
  });
  const winner = admissible[0];
  if (!winner || winner.road == null) {
    const unverified =
      rejected.length > 0 &&
      rejected.every((item) => item.reason === "xl_progress_unverified" || item.reason === "xl_progress_inconsistent");
    return fail(unverified ? "xl_dispatch_no_verified_driver" : "xl_dispatch_no_driver", rejected);
  }
  return {
    ok: true,
    departureId: winner.id,
    driverId: winner.driverId,
    seatIndex: winner.seatIndex,
    segmentCodes: requestedCodes,
    distanceMeters: winner.road.distanceMeters,
    etaMinutes: winner.road.etaMinutes,
    commercialBooking: false,
  };
}

function finiteCoord(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return null;
  return number;
}

function nestedSegment(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return (value[0] as Record<string, unknown> | undefined) ?? null;
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return null;
}

/**
 * Reads open segment departures and ranks one of them.
 * A Mapbox failure leaves that driver without a road measurement.
 */
export async function loadXlSegmentDispatchMatch(
  supabase: SupabaseClient,
  input: {
    originLabel: unknown;
    destinationLabel: unknown;
    pickupLat: unknown;
    pickupLng: unknown;
    requestedPickupAtMs: number | null;
    nowMs: number;
    excludeDepartureIds?: string[];
    measureRoad: (
      from: { lat: number; lng: number },
      to: { lat: number; lng: number },
    ) => Promise<XlDispatchRoad | null>;
  },
): Promise<XlDispatchChoice | XlDispatchFailure> {
  const pickupLat = finiteCoord(input.pickupLat);
  const pickupLng = finiteCoord(input.pickupLng);
  if (pickupLat == null || pickupLng == null) return fail("xl_dispatch_pickup_required");
  if (input.requestedPickupAtMs == null) return fail("xl_pickup_time_required");

  const limitsRow = await supabase
    .from("guinea_xl_segment_tariff")
    .select("max_pickup_meters,max_detour_meters,max_pickup_delay_minutes,max_location_age_seconds")
    .eq("id", "GN")
    .maybeSingle();
  if (limitsRow.error) {
    if (/max_pickup_meters|max_detour_meters|schema cache|does not exist/i.test(limitsRow.error.message)) {
      return fail("xl_dispatch_not_configured");
    }
    return fail("xl_catalog_failed");
  }
  const limits = dispatchLimitsFromRow((limitsRow.data ?? null) as Record<string, unknown> | null);
  if (!limits) return fail("xl_dispatch_not_configured");

  const [segmentRows, departureRows] = await Promise.all([
    supabase
      .from("guinea_xl_segments")
      .select("id,code,sequence,origin_label,destination_label,branch,distance_km,duration_minutes,active,confirmed,version,estimate_source")
      .order("sequence"),
    supabase
      .from("guinea_xl_departures")
      .select("id,driver_id,passenger_capacity,scheduled_at,status,segment_run")
      .eq("segment_run", true)
      .in("status", ["open", "completed", "canceled"]),
  ]);
  if (segmentRows.error || departureRows.error) return fail("xl_departure_unavailable");
  const segments = ((segmentRows.data ?? []) as Array<Record<string, unknown>>).map(segmentFromRow);
  const departures = (departureRows.data ?? []) as Array<Record<string, unknown>>;
  const departureIds = departures.map((row) => String(row.id));
  const driverIds = [...new Set(departures.map((row) => String(row.driver_id)))];
  if (departureIds.length === 0) return fail("xl_dispatch_no_driver");

  const [links, seatSegments, seats, progressEvents, features] = await Promise.all([
    supabase
      .from("guinea_xl_departure_segments")
      .select("departure_id,position,guinea_xl_segments(code,branch,distance_km,duration_minutes)")
      .in("departure_id", departureIds),
    supabase
      .from("guinea_xl_seat_segments")
      .select("departure_id,seat_index,booking_id,guinea_xl_segments(code)")
      .in("departure_id", departureIds),
    supabase.from("guinea_xl_seats").select("departure_id,seat_index,booking_id").in("departure_id", departureIds),
    supabase
      .from("guinea_xl_progress_events")
      .select("event_id,departure_id,kind,stop_index,lat,lng,captured_at,received_at,reason")
      .in("departure_id", departureIds),
    supabase.from("taxi_driver_features").select("user_id,xl_eligible").in("user_id", driverIds),
  ]);
  if ([links, seatSegments, seats, features].some((result) => result.error)) {
    return fail("xl_departure_unavailable");
  }
  const progressReady = !progressEvents.error;
  const progressMissing =
    !!progressEvents.error &&
    /guinea_xl_progress_events|schema cache|does not exist/i.test(progressEvents.error.message);
  if (progressEvents.error && !progressMissing) return fail("xl_departure_unavailable");

  const eligible = new Set(
    ((features.data ?? []) as Array<Record<string, unknown>>)
      .filter((row) => row.xl_eligible === true)
      .map((row) => String(row.user_id)),
  );
  const eventsByDeparture = new Map<string, XlProgressEvent[]>();
  if (progressReady) {
    for (const row of (progressEvents.data ?? []) as Array<Record<string, unknown>>) {
      const event = xlProgressEventFromStoredRow(row);
      if (!event) continue;
      const list = eventsByDeparture.get(String(row.departure_id)) ?? [];
      list.push(event);
      eventsByDeparture.set(String(row.departure_id), list);
    }
  }
  const linksByDeparture = new Map<string, Array<Record<string, unknown>>>();
  for (const row of (links.data ?? []) as Array<Record<string, unknown>>) {
    const list = linksByDeparture.get(String(row.departure_id)) ?? [];
    list.push(row);
    linksByDeparture.set(String(row.departure_id), list);
  }
  const holdsByDeparture = new Map<string, XlDispatchHold[]>();
  for (const row of (seatSegments.data ?? []) as Array<Record<string, unknown>>) {
    const segment = nestedSegment(row.guinea_xl_segments);
    const code = segment ? String(segment.code) : "";
    if (!code) continue;
    const list = holdsByDeparture.get(String(row.departure_id)) ?? [];
    const seatIndex = Number(row.seat_index);
    const existing = list.find((hold) => hold.seatIndex === seatIndex && !hold.blocksSeat);
    if (existing) existing.segmentCodes.push(code);
    else list.push({ seatIndex, segmentCodes: [code], blocksSeat: false });
    holdsByDeparture.set(String(row.departure_id), list);
  }
  for (const row of (seats.data ?? []) as Array<Record<string, unknown>>) {
    if (!row.booking_id) continue;
    const list = holdsByDeparture.get(String(row.departure_id)) ?? [];
    list.push({ seatIndex: Number(row.seat_index), segmentCodes: [], blocksSeat: true });
    holdsByDeparture.set(String(row.departure_id), list);
  }

  const requested = findXlSegmentPath(segments, input.originLabel, input.destinationLabel);
  const requestedCodes = requested.ok ? requested.segments.map((segment) => segment.code) : [];
  const prepared: XlDispatchDeparture[] = [];
  for (const row of departures) {
    const driverId = String(row.driver_id);
    const ordered = (linksByDeparture.get(String(row.id)) ?? [])
      .slice()
      .sort((left, right) => Number(left.position) - Number(right.position));
    const segmentList: XlDispatchSegment[] = ordered.map((link) => {
      const segment = nestedSegment(link.guinea_xl_segments);
      const branch = segment?.branch === "dougountounny" || segment?.branch === "mali" ? segment.branch : "trunk";
      return {
        code: String(segment?.code ?? ""),
        branch,
        distanceKm: segment?.distance_km == null ? null : Number(segment.distance_km),
        durationMinutes: segment?.duration_minutes == null ? null : Number(segment.duration_minutes),
      };
    });
    const progress = progressReady
      ? establishXlSegmentProgress({
          segmentCodes: segmentList.map((segment) => segment.code),
          pickupSegmentCode: requestedCodes[0] ?? "",
          events: eventsByDeparture.get(String(row.id)) ?? [],
          nowMs: input.nowMs,
          maxLocationAgeMs: limits.maxLocationAgeMs,
        })
      : null;
    const progressStatus: XlProgressStatus = progress?.status ?? "unverified";
    const serverGps = progress?.locationClass === "server_recent" ? progress.serverGps : null;
    const status = row.status === "completed" || row.status === "canceled" || row.status === "open" ? row.status : "closed";
    const draft: XlDispatchDeparture = {
      id: String(row.id),
      driverId,
      status,
      driverAvailable: eligible.has(driverId),
      capacity: Number(row.passenger_capacity),
      scheduledAtMs: row.scheduled_at ? Date.parse(String(row.scheduled_at)) : null,
      segments: segmentList,
      progress: progressStatus,
      passedSegmentCodes: progress?.passedSegmentCodes ?? [],
      holds: holdsByDeparture.get(String(row.id)) ?? [],
      locationUpdatedAtMs: serverGps?.receivedAtMs ?? null,
      road: null,
    };
    const routeAllowsMeasurement =
      (progressStatus === "before" || progressStatus === "at") &&
      requestedCodes.length > 0 &&
      xlDepartureRouteRejection(draft, requestedCodes) == null;
    if (routeAllowsMeasurement && serverGps) {
      draft.road = await input.measureRoad(
        { lat: serverGps.lat, lng: serverGps.lng },
        { lat: pickupLat, lng: pickupLng },
      );
    }
    prepared.push(draft);
  }

  return selectXlSegmentDriver({
    segments,
    originLabel: input.originLabel,
    destinationLabel: input.destinationLabel,
    requestedPickupAtMs: input.requestedPickupAtMs,
    nowMs: input.nowMs,
    limits,
    departures: prepared,
    excludeDepartureIds: input.excludeDepartureIds,
  });
}
