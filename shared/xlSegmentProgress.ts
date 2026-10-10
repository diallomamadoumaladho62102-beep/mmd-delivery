/**
 * XL segment progress from events the server has actually stored.
 * A planned route and a nearby GPS point do not prove a stop was reached.
 * Device time is not server receipt time. These clock bounds are integrity
 * checks. They are not the administrable GPS freshness limit.
 */

export const XL_PROGRESS_CLOCK_AHEAD_MS = 2 * 60 * 1000;
export const XL_PROGRESS_CLOCK_BEHIND_MS = 6 * 60 * 60 * 1000;

export type XlProgressKind =
  | "gps"
  | "stop_reached"
  | "passenger_picked_up"
  | "passenger_dropped_off"
  | "progress_reconciled";

export type XlProgressEvent = {
  eventId: string;
  kind: XlProgressKind;
  stopIndex: number | null;
  lat: number | null;
  lng: number | null;
  capturedAtMs: number;
  /** Null means the phone still holds the event. The server has not accepted it. */
  receivedAtMs: number | null;
  reason?: string | null;
};

export type XlProgressStatus = "before" | "at" | "after" | "unverified" | "inconsistent";

export type XlProgressLocationClass = "server_recent" | "server_stale" | "local_only" | "missing";

export type XlProgressAssessment = {
  status: XlProgressStatus;
  passedSegmentCodes: string[];
  locationClass: XlProgressLocationClass;
  serverGps: { lat: number; lng: number; capturedAtMs: number; receivedAtMs: number } | null;
};

export type XlSyncStatus = "pending" | "accepted" | "rejected";

export type XlQueuedProgress = XlProgressEvent & {
  departureId: string;
  driverId: string;
  applied: boolean | null;
  /** Missing on events saved before this field existed. Pending until a receipt or a rejection. */
  syncStatus?: XlSyncStatus;
  rejection?: string | null;
};

export function xlProgressEventReliable(event: XlProgressEvent): boolean {
  if (event.receivedAtMs == null) return false;
  if (!Number.isSafeInteger(event.capturedAtMs) || !Number.isSafeInteger(event.receivedAtMs)) return false;
  if (event.capturedAtMs > event.receivedAtMs + XL_PROGRESS_CLOCK_AHEAD_MS) return false;
  if (event.receivedAtMs - event.capturedAtMs > XL_PROGRESS_CLOCK_BEHIND_MS) return false;
  if (event.kind === "progress_reconciled" && !String(event.reason ?? "").trim()) return false;
  if (event.kind !== "gps") {
    return event.stopIndex != null && Number.isSafeInteger(event.stopIndex) && event.stopIndex >= 0;
  }
  return Number.isFinite(event.lat) && Number.isFinite(event.lng);
}

function dedupe(events: XlProgressEvent[]): XlProgressEvent[] {
  const seen = new Set<string>();
  const rows: XlProgressEvent[] = [];
  for (const event of events) {
    if (!event.eventId || seen.has(event.eventId)) continue;
    seen.add(event.eventId);
    rows.push(event);
  }
  return rows;
}

/** The newest captured server GPS. A later upload of an older fix does not replace it. */
export function currentServerGps(events: XlProgressEvent[]): XlProgressAssessment["serverGps"] {
  const fixes = dedupe(events)
    .filter((event) => event.kind === "gps" && xlProgressEventReliable(event))
    .sort((left, right) => {
      const captured = right.capturedAtMs - left.capturedAtMs;
      if (captured !== 0) return captured;
      return (right.receivedAtMs ?? 0) - (left.receivedAtMs ?? 0);
    });
  const winner = fixes[0];
  if (!winner || winner.receivedAtMs == null || winner.lat == null || winner.lng == null) return null;
  return {
    lat: winner.lat,
    lng: winner.lng,
    capturedAtMs: winner.capturedAtMs,
    receivedAtMs: winner.receivedAtMs,
  };
}

/**
 * stopIndex 0 is the departure origin. stopIndex n means the destination of
 * segment n has been reported. Pickup index is the requested segment's place
 * in this departure. A missing or contradictory chain stays unverified.
 */
export function establishXlSegmentProgress(input: {
  segmentCodes: string[];
  pickupSegmentCode: string;
  events: XlProgressEvent[];
  nowMs: number;
  maxLocationAgeMs: number;
}): XlProgressAssessment {
  const events = dedupe(input.events);
  const serverGps = currentServerGps(events);
  const localOnly =
    serverGps == null &&
    events.some(
      (event) =>
        event.kind === "gps" &&
        event.receivedAtMs == null &&
        Number.isFinite(event.lat) &&
        Number.isFinite(event.lng),
    );
  const fresh =
    serverGps != null &&
    Number.isSafeInteger(input.maxLocationAgeMs) &&
    input.nowMs - serverGps.receivedAtMs <= input.maxLocationAgeMs &&
    input.nowMs >= serverGps.receivedAtMs;
  const locationClass: XlProgressLocationClass = serverGps
    ? fresh
      ? "server_recent"
      : "server_stale"
    : localOnly
      ? "local_only"
      : "missing";
  const pickupAt = input.segmentCodes.indexOf(input.pickupSegmentCode);
  const empty = (status: XlProgressStatus): XlProgressAssessment => ({
    status,
    passedSegmentCodes: [],
    locationClass,
    serverGps,
  });
  if (pickupAt < 0 || !Number.isSafeInteger(input.nowMs) || !Number.isSafeInteger(input.maxLocationAgeMs)) {
    return empty("unverified");
  }

  const stops = events
    .filter((event) => event.kind !== "gps")
    .slice()
    .sort((left, right) => (left.receivedAtMs ?? Number.MAX_SAFE_INTEGER) - (right.receivedAtMs ?? Number.MAX_SAFE_INTEGER));
  let index: number | null = null;
  let inconsistent = false;
  let unreliableStop = false;
  let latestReliableReceipt: number | null = null;
  for (const event of stops) {
    if (!xlProgressEventReliable(event) || event.stopIndex == null) {
      unreliableStop = true;
      continue;
    }
    if (latestReliableReceipt == null || event.receivedAtMs! > latestReliableReceipt) {
      latestReliableReceipt = event.receivedAtMs!;
    }
    if (index == null) {
      if (event.stopIndex !== 0) inconsistent = true;
      else index = 0;
      continue;
    }
    if (event.stopIndex === index) continue;
    if (event.stopIndex === index + 1) {
      index = event.stopIndex;
      continue;
    }
    inconsistent = true;
  }

  if (inconsistent || index == null) return empty(inconsistent ? "inconsistent" : "unverified");
  const passed = unreliableStop && index <= pickupAt ? [] : input.segmentCodes.slice(0, index);
  if (unreliableStop && index <= pickupAt) return empty("unverified");
  if (index > pickupAt) {
    return { status: "after", passedSegmentCodes: passed, locationClass, serverGps };
  }
  const confirmationFresh =
    latestReliableReceipt != null && input.nowMs - latestReliableReceipt <= input.maxLocationAgeMs;
  if (!confirmationFresh) return empty("unverified");
  return {
    status: index === pickupAt ? "at" : "before",
    passedSegmentCodes: passed,
    locationClass,
    serverGps,
  };
}

export function enqueueXlProgress(
  events: XlQueuedProgress[],
  event: XlQueuedProgress,
): { events: XlQueuedProgress[]; status: "queued" | "duplicate" } {
  if (!event.eventId || events.some((row) => row.eventId === event.eventId)) {
    return { events, status: "duplicate" };
  }
  return {
    events: [
      ...events,
      { ...event, receivedAtMs: null, applied: null, syncStatus: "pending", rejection: null },
    ],
    status: "queued",
  };
}

/** The last stop reached on this phone. Rejected events do not count. */
export function xlReachedStopIndex(
  events: XlQueuedProgress[],
  departureId: string,
): { ok: true; index: number | null } | { ok: false; error: "xl_progress_inconsistent" } {
  const chain = events
    .filter(
      (event) =>
        event.departureId === departureId &&
        event.syncStatus !== "rejected" &&
        event.kind !== "gps" &&
        event.stopIndex != null,
    )
    .slice()
    .sort((left, right) => left.capturedAtMs - right.capturedAtMs);
  let index: number | null = null;
  for (const event of chain) {
    const stopIndex = event.stopIndex;
    if (stopIndex == null) continue;
    if (event.kind === "passenger_picked_up" || event.kind === "passenger_dropped_off") {
      if (index == null || stopIndex !== index) return { ok: false, error: "xl_progress_inconsistent" };
      continue;
    }
    if (index == null) {
      if (stopIndex !== 0) return { ok: false, error: "xl_progress_inconsistent" };
      index = 0;
      continue;
    }
    if (stopIndex === index) continue;
    if (stopIndex === index + 1) {
      index = stopIndex;
      continue;
    }
    return { ok: false, error: "xl_progress_inconsistent" };
  }
  return { ok: true, index };
}

/**
 * Local guard before a driver action is stored.
 * Stop 0 is the departure start. The next stop is only the following index.
 * A pickup or dropoff stays on the stop already reached. A manual note is the
 * next stop and still requires a reason. It is not a GPS point.
 */
export function planXlDriverEvent(input: {
  events: XlQueuedProgress[];
  departureId: string;
  kind: Exclude<XlProgressKind, "gps">;
  stopIndex: number;
  maxStopIndex: number;
  reason?: string | null;
}): { ok: true } | { ok: false; error: "xl_progress_inconsistent" | "xl_progress_duplicate" } {
  if (!Number.isSafeInteger(input.stopIndex) || input.stopIndex < 0 || input.stopIndex > input.maxStopIndex) {
    return { ok: false, error: "xl_progress_inconsistent" };
  }
  if (input.kind === "progress_reconciled" && !String(input.reason ?? "").trim()) {
    return { ok: false, error: "xl_progress_inconsistent" };
  }
  const reached = xlReachedStopIndex(input.events, input.departureId);
  if (reached.ok === false) return reached;
  const index = reached.index;
  const chain = input.events.filter(
    (event) => event.departureId === input.departureId && event.syncStatus !== "rejected" && event.kind !== "gps",
  );
  if (input.kind === "passenger_picked_up" || input.kind === "passenger_dropped_off") {
    if (index == null || input.stopIndex !== index) return { ok: false, error: "xl_progress_inconsistent" };
    const same = chain.some((event) => event.kind === input.kind && event.stopIndex === input.stopIndex);
    if (same) return { ok: false, error: "xl_progress_duplicate" };
    return { ok: true };
  }
  const expected = index == null ? 0 : index + 1;
  if (input.stopIndex !== expected) return { ok: false, error: "xl_progress_inconsistent" };
  return { ok: true };
}

export function acknowledgeXlProgress(
  events: XlQueuedProgress[],
  acks: Array<{ eventId: string; receivedAtMs: number; applied: boolean }>,
): XlQueuedProgress[] {
  const byId = new Map(acks.map((ack) => [ack.eventId, ack]));
  return events.map((event) => {
    const ack = byId.get(event.eventId);
    if (!ack || !Number.isSafeInteger(ack.receivedAtMs)) return event;
    if (event.receivedAtMs != null || event.syncStatus === "rejected") return event;
    return { ...event, receivedAtMs: ack.receivedAtMs, applied: ack.applied, syncStatus: "accepted", rejection: null };
  });
}

/** A rejection is kept. It is not a confirmation and it is not sent again. */
export function rejectXlProgress(
  events: XlQueuedProgress[],
  rejected: Array<{ eventId: string; error: string }>,
): XlQueuedProgress[] {
  const byId = new Map(rejected.map((item) => [item.eventId, item.error || "rejected"]));
  return events.map((event) => {
    const error = byId.get(event.eventId);
    if (!error || event.receivedAtMs != null || event.syncStatus === "accepted") return event;
    return { ...event, syncStatus: "rejected", rejection: error, applied: false };
  });
}

export function pendingXlProgress(events: XlQueuedProgress[]): XlQueuedProgress[] {
  return events.filter((event) => event.syncStatus !== "rejected" && event.receivedAtMs == null);
}
