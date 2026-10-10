import assert from "node:assert/strict";
import {
  selectXlSegmentDriver,
  type XlDispatchDeparture,
} from "@/lib/markets/guineaXlSegmentDispatch";
import { XL_SEGMENT_LOCAL_ESTIMATES } from "@/lib/markets/guineaXlSegmentCatalog";
import { XL_SEGMENT_COMMERCIAL_BOOKING_ENABLED } from "@/lib/markets/guineaXlSegments";
import {
  recordXlDriverAction,
  recordXlGpsFix,
  readActiveXlDeparture,
  rememberActiveXlDeparture,
  type XlActiveDeparture,
} from "../../../../mobile/src/lib/xlProgressRecord";
import { flushXlProgress, queueXlProgress, readXlProgress, type XlProgressStorage } from "../../../../mobile/src/lib/xlProgressQueue";
import {
  planXlDriverEvent,
  XL_PROGRESS_CLOCK_AHEAD_MS,
  establishXlSegmentProgress,
  type XlProgressEvent,
  type XlQueuedProgress,
} from "../../../../../shared/xlSegmentProgress";
import {
  interpretXlProgressSyncResponse,
  xlProgressEventFromStoredRow,
  xlProgressHttpBodyFromRpc,
  xlProgressSyncEvents,
} from "../../../../../shared/xlProgressWire";

const stops = ["Conakry", "Kindia", "Mamou", "Dalaba", "Pita", "Labé"];
const codes = ["1", "2", "3", "4", "5"];
const t0 = 1_700_000_000_000;
const serverNow = t0 + 30_000;
const limits = {
  maxPickupMeters: 450_000,
  maxDetourMeters: 30_000,
  maxPickupDelayMinutes: 180,
  maxLocationAgeMs: 1_200_000,
};

type Stored = XlProgressEvent & { departureId: string; driverId: string };

function memory() {
  const rows = new Map<string, string>();
  const storage: XlProgressStorage = {
    async getItem(key) {
      return rows.get(key) ?? null;
    },
    async setItem(key, value) {
      rows.set(key, value);
    },
  };
  return { rows, storage };
}

function rpcRow(event: Stored, idempotent: boolean) {
  return {
    event_id: event.eventId,
    departure_id: event.departureId,
    driver_id: event.driverId,
    kind: event.kind,
    stop_index: event.stopIndex,
    lat: event.lat,
    lng: event.lng,
    captured_at: new Date(event.capturedAtMs).toISOString(),
    received_at: new Date(event.receivedAtMs ?? 0).toISOString(),
    reason: event.reason ?? null,
    idempotent,
  };
}

function simulateAccept(
  sessionDriverId: string,
  body: Array<Record<string, unknown>>,
  owners: Map<string, string>,
  store: Stored[],
) {
  const events: Array<Record<string, unknown>> = [];
  for (const raw of body) {
    const eventId = String(raw.event_id ?? "");
    const departureId = String(raw.departure_id ?? "");
    const existing = store.find((event) => event.eventId === eventId);
    if (existing) {
      events.push(
        existing.driverId === sessionDriverId
          ? rpcRow(existing, true)
          : { event_id: eventId, error: "xl_departure_unavailable" },
      );
      continue;
    }
    if (owners.get(departureId) !== sessionDriverId) {
      events.push({ event_id: eventId, error: "xl_departure_unavailable" });
      continue;
    }
    const capturedAtMs = Date.parse(String(raw.captured_at ?? ""));
    if (
      !Number.isFinite(capturedAtMs) ||
      capturedAtMs > serverNow + XL_PROGRESS_CLOCK_AHEAD_MS ||
      serverNow - capturedAtMs > 6 * 60 * 60 * 1000
    ) {
      events.push({ event_id: eventId, error: "xl_progress_clock" });
      continue;
    }
    const kind = raw.kind;
    const stopIndex = raw.stop_index == null ? null : Number(raw.stop_index);
    const lat = raw.lat == null ? null : Number(raw.lat);
    const lng = raw.lng == null ? null : Number(raw.lng);
    const reason = raw.reason == null ? null : String(raw.reason);
    if (kind === "gps") {
      if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
        events.push({ event_id: eventId, error: "xl_progress_invalid" });
        continue;
      }
    } else if (
      kind === "stop_reached" ||
      kind === "passenger_picked_up" ||
      kind === "passenger_dropped_off" ||
      kind === "progress_reconciled"
    ) {
      const planned = planXlDriverEvent({
        events: store
          .filter((event) => event.departureId === departureId)
          .map((event) => ({ ...event, applied: true, syncStatus: "accepted" as const })),
        departureId,
        kind,
        stopIndex: stopIndex ?? -1,
        maxStopIndex: stops.length - 1,
        reason,
      });
      if (planned.ok === false) {
        events.push({ event_id: eventId, error: planned.error });
        continue;
      }
    } else {
      events.push({ event_id: eventId, error: "xl_progress_invalid" });
      continue;
    }
    const stored: Stored = {
      eventId,
      departureId,
      driverId: sessionDriverId,
      kind,
      stopIndex,
      lat,
      lng,
      capturedAtMs,
      receivedAtMs: serverNow,
      reason,
    };
    store.push(stored);
    events.push(rpcRow(stored, false));
  }
  return { ok: true as const, events };
}

function departureFrom(progress: ReturnType<typeof establishXlSegmentProgress>, id: string): XlDispatchDeparture {
  const segments = XL_SEGMENT_LOCAL_ESTIMATES.filter((segment) => codes.includes(segment.code)).map((segment) => ({
    code: segment.code,
    branch: segment.branch,
    distanceKm: segment.distanceKm,
    durationMinutes: segment.durationMinutes,
  }));
  return {
    id,
    driverId: "driver-a",
    status: "open",
    driverAvailable: true,
    capacity: 1,
    scheduledAtMs: null,
    segments,
    progress: progress.status,
    passedSegmentCodes: progress.passedSegmentCodes,
    holds: [],
    locationUpdatedAtMs: progress.locationClass === "server_recent" ? progress.serverGps?.receivedAtMs ?? null : null,
    road: progress.locationClass === "server_recent" ? { distanceMeters: 12_000, etaMinutes: 18 } : null,
  };
}

function choose(row: XlDispatchDeparture) {
  return selectXlSegmentDriver({
    segments: XL_SEGMENT_LOCAL_ESTIMATES,
    originLabel: "Dalaba",
    destinationLabel: "Pita",
    requestedPickupAtMs: serverNow,
    nowMs: serverNow + 1_000,
    limits,
    departures: [row],
  });
}

async function runIntegration() {
  const blankGps = xlProgressEventFromStoredRow({
    event_id: "blank",
    kind: "gps",
    lat: null,
    lng: null,
    captured_at: new Date(t0).toISOString(),
    received_at: new Date(serverNow).toISOString(),
  });
  assert.equal(blankGps?.lat, null);
  assert.equal(blankGps?.lng, null);
  assert.equal(interpretXlProgressSyncResponse({ ok: true }).ok, false);
  assert.equal(interpretXlProgressSyncResponse({ ok: true, acks: "nope" }).ok, false);
  assert.equal(interpretXlProgressSyncResponse({ ok: true, acks: [], rejected: "nope" }).ok, false);

  const { rows, storage } = memory();
  const departure: XlActiveDeparture = {
    departureId: "departure-a",
    driverId: "driver-a",
    stops,
  };
  await rememberActiveXlDeparture(storage, departure);
  const start = await recordXlDriverAction(storage, {
    departure,
    kind: "stop_reached",
    placement: "start",
    capturedAtMs: t0,
  });
  if (start.ok === false) throw new Error(start.error);
  const offline = await flushXlProgress(storage, async () => {
    throw new Error("offline");
  });
  assert.equal(offline.synced, 0);
  assert.equal((await readXlProgress(storage)).every((event) => event.receivedAtMs == null), true);

  const missed = await recordXlGpsFix(storage, {
    driverId: "driver-a",
    latitude: Number.NaN,
    longitude: -13.5,
    capturedAtMs: t0 + 1_000,
  });
  assert.equal(missed.queued, false);
  const firstGps = await recordXlGpsFix(storage, {
    driverId: "driver-a",
    latitude: 9.64,
    longitude: -13.57,
    capturedAtMs: t0 + 1_000,
  });
  assert.equal(firstGps.queued, true);
  const tooClose = await recordXlGpsFix(storage, {
    driverId: "driver-a",
    latitude: 9.64001,
    longitude: -13.57001,
    capturedAtMs: t0 + 2_000,
  });
  assert.equal(tooClose.queued, false);
  const nextGps = await recordXlGpsFix(storage, {
    driverId: "driver-a",
    latitude: 10.05,
    longitude: -12.86,
    capturedAtMs: t0 + 5_000,
  });
  assert.equal(nextGps.queued, true);
  const kindia = await recordXlDriverAction(storage, {
    departure,
    kind: "stop_reached",
    placement: "next",
    capturedAtMs: t0 + 6_000,
  });
  if (kindia.ok === false) throw new Error(kindia.error);
  assert.equal(kindia.event.stopIndex, 1);
  const pickup = await recordXlDriverAction(storage, {
    departure,
    kind: "passenger_picked_up",
    placement: "current",
    capturedAtMs: t0 + 7_000,
  });
  if (pickup.ok === false) throw new Error(pickup.error);
  const dropoff = await recordXlDriverAction(storage, {
    departure,
    kind: "passenger_dropped_off",
    placement: "current",
    capturedAtMs: t0 + 8_000,
  });
  if (dropoff.ok === false) throw new Error(dropoff.error);
  const skipped = await recordXlDriverAction(storage, {
    departure,
    kind: "stop_reached",
    placement: "start",
    capturedAtMs: t0 + 9_000,
  });
  assert.equal(skipped.ok, false);

  const reopened: XlProgressStorage = {
    async getItem(key) {
      return rows.get(key) ?? null;
    },
    async setItem(key, value) {
      rows.set(key, value);
    },
  };
  const restored = await readActiveXlDeparture(reopened);
  assert.equal(restored?.departureId, departure.departureId);
  assert.equal((await readXlProgress(reopened)).length, 6);
  assert.equal((await readXlProgress(reopened)).every((event) => event.syncStatus !== "accepted"), true);

  const tampered: XlQueuedProgress = {
    eventId: "tampered-stop",
    departureId: departure.departureId,
    driverId: "driver-a",
    kind: "stop_reached",
    stopIndex: 4,
    lat: null,
    lng: null,
    capturedAtMs: t0 + 9_000,
    receivedAtMs: null,
    applied: null,
    syncStatus: "pending",
  };
  const clock: XlQueuedProgress = {
    ...tampered,
    eventId: "future-clock",
    stopIndex: 2,
    capturedAtMs: serverNow + XL_PROGRESS_CLOCK_AHEAD_MS + 60_000,
  };
  await queueXlProgress(reopened, tampered);
  await queueXlProgress(reopened, clock);

  const owners = new Map([[departure.departureId, "driver-a"]]);
  const store: Stored[] = [];
  let sends = 0;
  const synced = await flushXlProgress(reopened, async (pending) => {
    sends += 1;
    const request = xlProgressSyncEvents(pending);
    assert.equal(request.every((event) => !Object.prototype.hasOwnProperty.call(event, "driver_id")), true);
    const spoofed = request.map((event) => ({ ...event, driver_id: "driver-b" }));
    const rpc = simulateAccept("driver-a", spoofed, owners, store);
    assert.equal(store.every((event) => event.driverId === "driver-a"), true);
    return interpretXlProgressSyncResponse(xlProgressHttpBodyFromRpc(rpc));
  });
  assert.equal(synced.synced > 0, true);
  assert.equal(synced.rejected, 2);
  const phone = await readXlProgress(reopened);
  assert.equal(phone.find((event) => event.eventId === "tampered-stop")?.syncStatus, "rejected");
  assert.equal(phone.find((event) => event.eventId === "tampered-stop")?.rejection, "xl_progress_inconsistent");
  assert.equal(phone.find((event) => event.eventId === "future-clock")?.rejection, "xl_progress_clock");
  assert.equal(phone.find((event) => event.eventId === start.event.eventId)?.syncStatus, "accepted");
  const again = await flushXlProgress(reopened, async () => {
    throw new Error("accepted and rejected events must stay on the phone without a resend");
  });
  assert.equal(again.synced, 0);
  assert.equal(sends, 1);

  const denied = simulateAccept("driver-b", xlProgressSyncEvents(phone.filter((event) => event.syncStatus === "accepted")), owners, store);
  assert.equal(denied.events.every((event) => event.error === "xl_departure_unavailable"), true);
  assert.equal(store.filter((event) => event.driverId === "driver-b").length, 0);

  const serverEvents = store.map((event) => xlProgressEventFromStoredRow(rpcRow(event, false))).filter((event) => event != null);
  const progress = establishXlSegmentProgress({
    segmentCodes: codes,
    pickupSegmentCode: "4",
    events: serverEvents,
    nowMs: serverNow + 1_000,
    maxLocationAgeMs: limits.maxLocationAgeMs,
  });
  assert.equal(progress.status, "before");
  assert.deepEqual(progress.passedSegmentCodes, ["1"]);
  assert.equal(progress.locationClass, "server_recent");
  assert.equal(progress.serverGps?.lat, 10.05);
  const selected = choose(departureFrom(progress, departure.departureId));
  if (selected.ok === false) throw new Error(selected.error);
  assert.equal(selected.seatIndex, 1);
  assert.equal(selected.commercialBooking, false);

  const held = departureFrom(progress, departure.departureId);
  held.holds = [{ seatIndex: 1, segmentCodes: ["1"], blocksSeat: false }];
  const later = choose(held);
  if (later.ok === false) throw new Error(later.error);
  held.holds = [
    { seatIndex: 1, segmentCodes: ["1"], blocksSeat: false },
    { seatIndex: 1, segmentCodes: ["4"], blocksSeat: false },
  ];
  const overlap = choose(held);
  assert.equal(overlap.ok, false);
  if (overlap.ok) return;
  assert.equal(overlap.rejected[0]?.reason, "xl_seat_taken");

  const passed = establishXlSegmentProgress({
    segmentCodes: codes,
    pickupSegmentCode: "4",
    events: [2, 3, 4].reduce<XlProgressEvent[]>((events, stopIndex) => {
      events.push({
        eventId: `stop-${stopIndex}`,
        kind: "stop_reached",
        stopIndex,
        lat: null,
        lng: null,
        capturedAtMs: t0 + 10_000 + stopIndex,
        receivedAtMs: serverNow,
      });
      return events;
    }, [...serverEvents]),
    nowMs: serverNow + 1_000,
    maxLocationAgeMs: limits.maxLocationAgeMs,
  });
  assert.equal(passed.status, "after");
  assert.equal(passed.passedSegmentCodes.includes("4"), true);
  const excluded = choose(departureFrom(passed, "passed"));
  assert.equal(excluded.ok, false);

  const unknown = establishXlSegmentProgress({
    segmentCodes: codes,
    pickupSegmentCode: "4",
    events: [],
    nowMs: serverNow + 1_000,
    maxLocationAgeMs: limits.maxLocationAgeMs,
  });
  assert.equal(unknown.status, "unverified");
  const hidden = choose(departureFrom(unknown, "unknown"));
  assert.equal(hidden.ok, false);
  if (hidden.ok) return;
  assert.equal(hidden.error, "xl_dispatch_no_verified_driver");
  assert.equal(XL_SEGMENT_COMMERCIAL_BOOKING_ENABLED, false);
  console.log("guineaXlOfflineDispatch.integration.test.ts passed");
}

runIntegration().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
