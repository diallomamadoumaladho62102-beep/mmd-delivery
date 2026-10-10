import { distanceMeters } from "./coordinates";
import {
  flushXlProgress,
  queueXlProgress,
  readXlProgress,
  type XlProgressStorage,
} from "./xlProgressQueue";
import {
  planXlDriverEvent,
  xlReachedStopIndex,
  type XlProgressKind,
  type XlQueuedProgress,
} from "../../../../shared/xlSegmentProgress";

const ACTIVE_KEY = "mmd.xl.activeDeparture.v1";
/** Same sampling gate as the live driver_locations upsert: 3 seconds and 10 meters. */
export const XL_GPS_MIN_INTERVAL_MS = 3000;
export const XL_GPS_MIN_DISTANCE_METERS = 10;

export type XlActiveDeparture = {
  departureId: string;
  driverId: string;
  stops: string[];
};

export type XlGpsFix = {
  driverId: string;
  latitude: number;
  longitude: number;
  capturedAtMs: number;
};

type FlushSend = Parameters<typeof flushXlProgress>[1];

let flushSend: FlushSend | null = null;

export function setXlProgressFlush(send: FlushSend | null) {
  flushSend = send;
}

export async function readActiveXlDeparture(storage: XlProgressStorage): Promise<XlActiveDeparture | null> {
  const raw = await storage.getItem(ACTIVE_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw) as Partial<XlActiveDeparture>;
  if (!parsed.departureId || !parsed.driverId || !Array.isArray(parsed.stops) || parsed.stops.length < 2) return null;
  return { departureId: parsed.departureId, driverId: parsed.driverId, stops: parsed.stops.map(String) };
}

export async function rememberActiveXlDeparture(storage: XlProgressStorage, departure: XlActiveDeparture | null) {
  if (!departure) {
    await storage.setItem(ACTIVE_KEY, "");
    return;
  }
  await storage.setItem(ACTIVE_KEY, JSON.stringify(departure));
}

export async function recordXlGpsFix(storage: XlProgressStorage, fix: XlGpsFix) {
  if (!fix.driverId || !Number.isFinite(fix.latitude) || !Number.isFinite(fix.longitude)) return { queued: false };
  const active = await readActiveXlDeparture(storage);
  if (!active || active.driverId !== fix.driverId) return { queued: false };
  const current = await readXlProgress(storage);
  const previous = [...current].reverse().find((event) => event.departureId === active.departureId && event.kind === "gps");
  if (
    previous &&
    previous.lat != null &&
    previous.lng != null &&
    fix.capturedAtMs - previous.capturedAtMs < XL_GPS_MIN_INTERVAL_MS &&
    distanceMeters(previous.lat, previous.lng, fix.latitude, fix.longitude) < XL_GPS_MIN_DISTANCE_METERS
  ) {
    return { queued: false };
  }
  const event = blankEvent(active, "gps", null, fix.capturedAtMs, fix.latitude, fix.longitude, null);
  const saved = await queueXlProgress(storage, event);
  if (saved.status === "queued" && flushSend) await flushXlProgress(storage, flushSend);
  return { queued: saved.status === "queued" };
}

export async function recordXlDriverAction(
  storage: XlProgressStorage,
  input: {
    departure: XlActiveDeparture;
    kind: Exclude<XlProgressKind, "gps">;
    placement: "start" | "next" | "current";
    capturedAtMs: number;
    reason?: string | null;
  },
) {
  const current = await readXlProgress(storage);
  const reached = xlReachedStopIndex(current, input.departure.departureId);
  if (reached.ok === false) return reached;
  if (input.placement === "start" && reached.index != null) {
    return { ok: false as const, error: "xl_progress_inconsistent" as const };
  }
  if (input.placement !== "start" && reached.index == null) {
    return { ok: false as const, error: "xl_progress_inconsistent" as const };
  }
  const stopIndex =
    input.kind === "passenger_picked_up" || input.kind === "passenger_dropped_off"
      ? reached.index
      : reached.index == null
        ? 0
        : reached.index + 1;
  if (stopIndex == null) return { ok: false as const, error: "xl_progress_inconsistent" as const };
  const planned = planXlDriverEvent({
    events: current,
    departureId: input.departure.departureId,
    kind: input.kind,
    stopIndex,
    maxStopIndex: input.departure.stops.length - 1,
    reason: input.reason,
  });
  if (planned.ok === false) return planned;
  const event = blankEvent(
    input.departure,
    input.kind,
    stopIndex,
    input.capturedAtMs,
    null,
    null,
    input.reason ?? null,
  );
  const saved = await queueXlProgress(storage, event);
  if (saved.status !== "queued") return { ok: false as const, error: "xl_progress_duplicate" as const };
  if (flushSend) await flushXlProgress(storage, flushSend);
  const stored = (await readXlProgress(storage)).find((row) => row.eventId === event.eventId) ?? event;
  return { ok: true as const, event: stored };
}

function blankEvent(
  departure: XlActiveDeparture,
  kind: XlProgressKind,
  stopIndex: number | null,
  capturedAtMs: number,
  lat: number | null,
  lng: number | null,
  reason: string | null,
): XlQueuedProgress {
  return {
    eventId: crypto.randomUUID(),
    departureId: departure.departureId,
    driverId: departure.driverId,
    kind,
    stopIndex,
    lat,
    lng,
    capturedAtMs,
    receivedAtMs: null,
    applied: null,
    reason,
    syncStatus: "pending",
    rejection: null,
  };
}
