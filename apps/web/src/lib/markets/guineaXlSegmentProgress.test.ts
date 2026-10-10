import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasPermission } from "@/lib/adminRbac";
import {
  dispatchLimitsFromRow,
  interpretDispatchLimitSave,
  parseDispatchLimitInput,
  selectXlSegmentDriver,
  type XlDispatchDeparture,
} from "@/lib/markets/guineaXlSegmentDispatch";
import { XL_SEGMENT_LOCAL_ESTIMATES } from "@/lib/markets/guineaXlSegmentCatalog";
import { XL_SEGMENT_COMMERCIAL_BOOKING_ENABLED } from "@/lib/markets/guineaXlSegments";
import {
  acknowledgeXlProgress,
  currentServerGps,
  enqueueXlProgress,
  establishXlSegmentProgress,
  pendingXlProgress,
  planXlDriverEvent,
  rejectXlProgress,
  xlReachedStopIndex,
  type XlProgressEvent,
  type XlQueuedProgress,
} from "../../../../../shared/xlSegmentProgress";
import { flushXlProgress, queueXlProgress, readXlProgress, type XlProgressStorage } from "../../../../mobile/src/lib/xlProgressQueue";

const nowMs = 1_700_000_000_000;
const ageMs = 10 * 60_000;
const codes = ["1", "2", "3", "4", "5"];

const tests: Array<{ name: string; fn: () => void | Promise<void> }> = [];

function test(name: string, fn: () => void | Promise<void>) {
  tests.push({ name, fn });
}

function stop(eventId: string, stopIndex: number, receivedAtMs: number | null, capturedAtMs = receivedAtMs ?? nowMs): XlProgressEvent {
  return {
    eventId,
    kind: "stop_reached",
    stopIndex,
    lat: null,
    lng: null,
    capturedAtMs,
    receivedAtMs,
  };
}

function gps(eventId: string, capturedAtMs: number, receivedAtMs: number | null, lat = 10): XlProgressEvent {
  return { eventId, kind: "gps", stopIndex: null, lat, lng: -12, capturedAtMs, receivedAtMs };
}

function assess(events: XlProgressEvent[], pickup = "4", maxLocationAgeMs = ageMs) {
  return establishXlSegmentProgress({
    segmentCodes: codes,
    pickupSegmentCode: pickup,
    events,
    nowMs,
    maxLocationAgeMs,
  });
}

function departure(progress: XlDispatchDeparture["progress"], passed: string[]): XlDispatchDeparture {
  return {
    id: "run",
    driverId: "driver-a",
    status: "open",
    driverAvailable: true,
    capacity: 4,
    scheduledAtMs: nowMs,
    segments: XL_SEGMENT_LOCAL_ESTIMATES.filter((segment) => codes.includes(segment.code)).map((segment) => ({
      code: segment.code,
      branch: segment.branch,
      distanceKm: segment.distanceKm,
      durationMinutes: segment.durationMinutes,
    })),
    progress,
    passedSegmentCodes: passed,
    holds: [],
    locationUpdatedAtMs: nowMs - 60_000,
    road: { distanceMeters: 12_000, etaMinutes: 18 },
  };
}

function choose(row: XlDispatchDeparture) {
  return selectXlSegmentDriver({
    segments: XL_SEGMENT_LOCAL_ESTIMATES,
    originLabel: "Dalaba",
    destinationLabel: "Pita",
    requestedPickupAtMs: nowMs,
    nowMs,
    limits: { maxPickupMeters: 400_000, maxDetourMeters: 20_000, maxPickupDelayMinutes: 30, maxLocationAgeMs: ageMs },
    departures: [row],
  });
}

test("a driver still before the pickup can be verified", () => {
  const progress = assess([stop("origin", 0, nowMs - 1_000), stop("kindia", 1, nowMs - 900), stop("mamou", 2, nowMs - 800)]);
  assert.equal(progress.status, "before");
  assert.deepEqual(progress.passedSegmentCodes, ["1", "2"]);
  const row = departure("before", progress.passedSegmentCodes);
  row.scheduledAtMs = null;
  const selected = choose(row);
  if (selected.ok === false) throw new Error(selected.error);
  assert.equal(selected.ok, true);
});

test("a driver at the pickup is admissible and one who passed it is not", () => {
  const atDalaba = assess([
    stop("origin", 0, nowMs - 1_000),
    stop("kindia", 1, nowMs - 900),
    stop("mamou", 2, nowMs - 800),
    stop("dalaba", 3, nowMs - 700),
  ]);
  assert.equal(atDalaba.status, "at");
  assert.deepEqual(atDalaba.passedSegmentCodes, ["1", "2", "3"]);
  assert.equal(choose(departure("at", atDalaba.passedSegmentCodes)).ok, true);
  const passed = assess([
    stop("origin", 0, nowMs - 1_000),
    stop("kindia", 1, nowMs - 900),
    stop("mamou", 2, nowMs - 800),
    stop("dalaba", 3, nowMs - 700),
    stop("pita", 4, nowMs - 600),
  ]);
  assert.equal(passed.status, "after");
  assert.equal(passed.passedSegmentCodes.includes("4"), true);
  const selected = choose(departure("after", passed.passedSegmentCodes));
  assert.equal(selected.ok, false);
  if (selected.ok) return;
  assert.equal(selected.rejected[0]?.reason, "xl_pickup_passed");
});

test("stale, missing, and local GPS do not become a server position", () => {
  const stale = assess([gps("old", nowMs - ageMs - 5_000, nowMs - ageMs - 1)]);
  assert.equal(stale.locationClass, "server_stale");
  assert.equal(stale.status, "unverified");
  const missing = assess([]);
  assert.equal(missing.locationClass, "missing");
  assert.equal(missing.status, "unverified");
  const local = assess([gps("phone", nowMs, null)]);
  assert.equal(local.locationClass, "local_only");
  assert.equal(local.serverGps, null);
  assert.equal(local.status, "unverified");
  const selected = choose(departure("unverified", []));
  assert.equal(selected.ok, false);
  if (selected.ok) return;
  assert.equal(selected.error, "xl_dispatch_no_verified_driver");
});

test("an old fix uploaded later does not replace a newer captured fix", () => {
  const events = [
    gps("newer", nowMs - 1_000, nowMs - 900, 11),
    gps("older", nowMs - 50_000, nowMs - 100, 99),
  ];
  assert.equal(currentServerGps(events)?.lat, 11);
  assert.equal(assess(events).serverGps?.lat, 11);
});

test("a repeated event, a gap, and a backwards event stay conservative", () => {
  const repeated = assess([
    stop("origin", 0, nowMs - 1_000),
    stop("origin", 0, nowMs - 900),
    stop("kindia", 1, nowMs - 800),
  ], "2");
  assert.equal(repeated.status, "at");
  const gap = assess([stop("origin", 0, nowMs - 1_000), stop("dalaba", 3, nowMs - 800)]);
  assert.equal(gap.status, "inconsistent");
  assert.deepEqual(gap.passedSegmentCodes, []);
  const backwards = assess([
    stop("origin", 0, nowMs - 1_000),
    stop("kindia", 1, nowMs - 900),
    stop("origin-late", 0, nowMs - 100),
  ]);
  assert.equal(backwards.status, "inconsistent");
  const selected = choose(departure("inconsistent", ["1"]));
  assert.equal(selected.ok, false);
  if (selected.ok) return;
  assert.equal(selected.error, "xl_dispatch_no_verified_driver");
});

test("a bad device clock or an unsynced stop does not invent progress", () => {
  const ahead = assess([stop("origin", 0, nowMs, nowMs + 10 * 60_000)]);
  assert.equal(ahead.status, "unverified");
  const behind = assess([stop("origin", 0, nowMs, nowMs - 7 * 60 * 60_000)]);
  assert.equal(behind.status, "unverified");
  const pending = assess([stop("origin", 0, null), gps("phone", nowMs, null)]);
  assert.equal(pending.status, "unverified");
  assert.equal(pending.locationClass, "local_only");
});

test("a manual reconciliation is not a GPS proof", () => {
  const reconciled = assess([
    {
      eventId: "staff",
      kind: "progress_reconciled",
      stopIndex: 3,
      lat: 10.6,
      lng: -12.2,
      capturedAtMs: nowMs - 1_000,
      receivedAtMs: nowMs - 900,
      reason: "driver called from Dalaba",
    },
  ]);
  assert.equal(reconciled.status, "inconsistent");
  assert.equal(reconciled.serverGps, null);
  const located = assess([
    stop("origin", 0, nowMs - 1_000),
    stop("kindia", 1, nowMs - 900),
    stop("mamou", 2, nowMs - 800),
    {
      eventId: "staff",
      kind: "progress_reconciled",
      stopIndex: 3,
      lat: 10.6,
      lng: -12.2,
      capturedAtMs: nowMs - 700,
      receivedAtMs: nowMs - 600,
      reason: "driver called from Dalaba",
    },
  ]);
  assert.equal(located.status, "at");
  assert.equal(located.serverGps, null);
  assert.equal(located.locationClass, "missing");
});

test("a dropoff frees the next portion without freeing an overlapping one", () => {
  const dropped = assess([
    stop("origin", 0, nowMs - 1_000),
    stop("kindia", 1, nowMs - 900),
    {
      eventId: "drop",
      kind: "passenger_dropped_off",
      stopIndex: 2,
      lat: null,
      lng: null,
      capturedAtMs: nowMs - 800,
      receivedAtMs: nowMs - 700,
    },
  ]);
  assert.equal(dropped.status, "before");
  const row = departure("before", dropped.passedSegmentCodes);
  row.scheduledAtMs = null;
  row.holds = [{ seatIndex: 1, segmentCodes: ["1", "2"], blocksSeat: false }];
  const next = choose(row);
  assert.equal(next.ok && next.seatIndex, 1);
  row.capacity = 1;
  row.holds = [
    { seatIndex: 1, segmentCodes: ["1", "2"], blocksSeat: false },
    { seatIndex: 1, segmentCodes: ["4"], blocksSeat: false },
  ];
  const overlap = choose(row);
  assert.equal(overlap.ok, false);
  if (overlap.ok) return;
  assert.equal(overlap.rejected[0]?.reason, "xl_seat_taken");
});

test("local progress syncs once and keeps the newer capture", async () => {
  const memory = new Map<string, string>();
  const storage: XlProgressStorage = {
    async getItem(key) {
      return memory.get(key) ?? null;
    },
    async setItem(key, value) {
      memory.set(key, value);
    },
  };
  const base: XlQueuedProgress = {
    eventId: "gps-new",
    departureId: "departure",
    driverId: "driver",
    kind: "gps",
    stopIndex: null,
    lat: 11,
    lng: -12,
    capturedAtMs: nowMs - 1_000,
    receivedAtMs: null,
    applied: null,
  };
  assert.equal((await queueXlProgress(storage, base)).status, "queued");
  assert.equal((await queueXlProgress(storage, base)).status, "duplicate");
  assert.equal((await readXlProgress(storage)).length, 1);
  const offline = await flushXlProgress(storage, async () => ({ ok: false }));
  assert.equal(offline.synced, 0);
  assert.equal((await readXlProgress(storage))[0]?.receivedAtMs, null);
  const online = await flushXlProgress(storage, async () => ({
    ok: true,
    acks: [{ eventId: "gps-new", receivedAtMs: nowMs - 900, applied: true }],
  }));
  assert.equal(online.synced, 1);
  const again = await flushXlProgress(storage, async () => {
    throw new Error("must not send an acknowledged event");
  });
  assert.equal(again.synced, 0);
  const older: XlQueuedProgress = { ...base, eventId: "gps-old", lat: 99, capturedAtMs: nowMs - 50_000 };
  await queueXlProgress(storage, older);
  const queued = await readXlProgress(storage);
  const acked = acknowledgeXlProgress(queued, [{ eventId: "gps-old", receivedAtMs: nowMs, applied: true }]);
  assert.equal(currentServerGps(acked)?.lat, 11);
  assert.equal(pendingXlProgress(acked).length, 0);
  assert.equal(XL_SEGMENT_COMMERCIAL_BOOKING_ENABLED, false);
});

test("dispatch limits are authorized, validated, reread, and applied", () => {
  assert.equal(hasPermission("super_admin", "taxi_pricing.read"), true);
  assert.equal(hasPermission("super_admin", "taxi_pricing.write"), true);
  assert.equal(hasPermission("finance_admin", "taxi_pricing.read"), true);
  assert.equal(hasPermission("finance_admin", "taxi_pricing.write"), false);
  assert.equal(hasPermission("operations_admin", "taxi_pricing.write"), false);
  assert.equal(parseDispatchLimitInput({}).ok, false);
  assert.equal(parseDispatchLimitInput({
    maxPickupMeters: "",
    maxDetourMeters: 1,
    maxPickupDelayMinutes: 1,
    maxLocationAgeSeconds: 1,
  }).ok, false);
  assert.equal(parseDispatchLimitInput({
    maxPickupMeters: -1,
    maxDetourMeters: 1,
    maxPickupDelayMinutes: 1,
    maxLocationAgeSeconds: 1,
  }).ok, false);
  const parsed = parseDispatchLimitInput({
    maxPickupMeters: "25000",
    maxDetourMeters: 30000,
    maxPickupDelayMinutes: 180,
    maxLocationAgeSeconds: 1200,
  });
  if (parsed.ok === false) throw new Error(parsed.error);
  const saved = interpretDispatchLimitSave({
    errorMessage: null,
    row: {
      max_pickup_meters: parsed.maxPickupMeters,
      max_detour_meters: parsed.maxDetourMeters,
      max_pickup_delay_minutes: parsed.maxPickupDelayMinutes,
      max_location_age_seconds: parsed.maxLocationAgeSeconds,
    },
  });
  if (saved.ok === false) throw new Error(saved.error);
  assert.equal(saved.limits.maxPickupMeters, 25_000);
  assert.equal(dispatchLimitsFromRow({
    max_pickup_meters: 25_000,
    max_detour_meters: 30_000,
    max_pickup_delay_minutes: 180,
    max_location_age_seconds: 1_200,
  })?.maxLocationAgeMs, 1_200_000);
  assert.equal(interpretDispatchLimitSave({ errorMessage: null, row: null }).ok, false);
  assert.equal(interpretDispatchLimitSave({ errorMessage: "connection reset", row: null }).ok, false);
  const route = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../app/api/admin/guinea-xl/route.ts"), "utf8");
  assert.match(route, /assertCanWriteTaxiPricing/);
  assert.match(route, /segment_dispatch_saved/);
  assert.match(route, /\.eq\("version", expectedVersion\)/);
  const pending = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../../supabase/pending/20261020120000_guinea_xl_segment_progress.sql"), "utf8");
  assert.match(pending, /do not apply/i);
  assert.equal(/guinea_standard_settings/i.test(pending), false);
  assert.equal(/platform_share_bps/i.test(pending), false);
  assert.equal(/confirmed\s*=\s*true/i.test(pending), false);
});

function action(eventId: string, kind: XlQueuedProgress["kind"], stopIndex: number | null, capturedAtMs: number): XlQueuedProgress {
  return {
    eventId,
    departureId: "departure",
    driverId: "driver",
    kind,
    stopIndex,
    lat: null,
    lng: null,
    capturedAtMs,
    receivedAtMs: null,
    applied: null,
    reason: kind === "progress_reconciled" ? "driver confirmed the stop" : null,
    syncStatus: "pending",
  };
}

test("offline driver actions stay queued until the server accepts or rejects them", async () => {
  const memory = new Map<string, string>();
  const storage: XlProgressStorage = {
    async getItem(key) {
      return memory.get(key) ?? null;
    },
    async setItem(key, value) {
      memory.set(key, value);
    },
  };
  const steps: XlQueuedProgress[] = [];
  const plan = (kind: XlQueuedProgress["kind"], stopIndex: number | null, reason?: string) =>
    planXlDriverEvent({
      events: steps,
      departureId: "departure",
      kind: kind === "gps" ? "stop_reached" : kind,
      stopIndex: stopIndex ?? -1,
      maxStopIndex: 2,
      reason,
    });
  assert.equal(plan("stop_reached", 2).ok, false);
  assert.equal(plan("passenger_picked_up", 0).ok, false);
  assert.equal(plan("progress_reconciled", 0, " ").ok, false);
  const start = action("start", "stop_reached", 0, nowMs);
  assert.equal(planXlDriverEvent({
    events: steps,
    departureId: "departure",
    kind: "stop_reached",
    stopIndex: 0,
    maxStopIndex: 2,
  }).ok, true);
  steps.push(start);
  assert.equal((await queueXlProgress(storage, start)).status, "queued");
  const pickup = action("pickup", "passenger_picked_up", 0, nowMs + 1);
  const dropoff = action("dropoff", "passenger_dropped_off", 0, nowMs + 2);
  assert.equal(planXlDriverEvent({ events: steps, departureId: "departure", kind: "passenger_picked_up", stopIndex: 0, maxStopIndex: 2 }).ok, true);
  steps.push(pickup);
  assert.equal(planXlDriverEvent({ events: steps, departureId: "departure", kind: "passenger_picked_up", stopIndex: 0, maxStopIndex: 2 }).ok, false);
  steps.push(dropoff);
  const next = action("next", "stop_reached", 1, nowMs + 3);
  steps.push(next);
  await queueXlProgress(storage, pickup);
  await queueXlProgress(storage, dropoff);
  await queueXlProgress(storage, next);
  const reopened: XlProgressStorage = {
    async getItem(key) {
      return memory.get(key) ?? null;
    },
    async setItem(key, value) {
      memory.set(key, value);
    },
  };
  assert.equal((await readXlProgress(reopened)).length, 4);
  const offline = await flushXlProgress(reopened, async () => ({ ok: false }));
  assert.equal(offline.synced, 0);
  assert.equal((await readXlProgress(reopened)).every((event) => event.receivedAtMs == null), true);
  const mixed = await flushXlProgress(reopened, async (pending) => ({
    ok: true,
    acks: pending.filter((event) => event.eventId !== "dropoff").map((event) => ({
      eventId: event.eventId,
      receivedAtMs: nowMs + 10,
      applied: event.kind !== "progress_reconciled",
    })),
    rejected: [{ eventId: "dropoff", error: "xl_progress_inconsistent" }],
  }));
  assert.equal(mixed.rejected, 1);
  const stored = await readXlProgress(reopened);
  assert.equal(stored.find((event) => event.eventId === "dropoff")?.syncStatus, "rejected");
  assert.equal(stored.find((event) => event.eventId === "start")?.syncStatus, "accepted");
  assert.equal(pendingXlProgress(stored).length, 0);
  const resent = await flushXlProgress(reopened, async () => {
    throw new Error("rejected and accepted events must not be sent again");
  });
  assert.equal(resent.synced, 0);
  const reached = xlReachedStopIndex(stored, "departure");
  assert.equal(reached.ok && reached.index, 1);
  const gpsNew = action("gps-new", "gps", null, nowMs + 20);
  gpsNew.lat = 11;
  gpsNew.lng = -12;
  const gpsOld = action("gps-old", "gps", null, nowMs);
  gpsOld.lat = 99;
  gpsOld.lng = -13;
  const gps = acknowledgeXlProgress(
    rejectXlProgress([gpsNew, gpsOld], []),
    [
      { eventId: "gps-new", receivedAtMs: nowMs + 30, applied: true },
      { eventId: "gps-old", receivedAtMs: nowMs + 40, applied: true },
    ],
  );
  assert.equal(currentServerGps(gps)?.lat, 11);
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");
  const tracker = fs.readFileSync(path.join(root, "apps/mobile/src/lib/driverLocationTracker.ts"), "utf8");
  const capture = fs.readFileSync(path.join(root, "apps/mobile/src/lib/xlProgressRecord.ts"), "utf8");
  const screen = fs.readFileSync(path.join(root, "apps/mobile/src/screens/taxi/DriverGuineaXlScreen.tsx"), "utf8");
  const http = fs.readFileSync(path.join(root, "apps/web/src/lib/markets/guineaXlHttp.ts"), "utf8");
  assert.match(tracker, /from\("driver_locations"\)\.upsert/);
  assert.match(tracker, /recordedFixSink/);
  assert.match(tracker, /finally/);
  assert.match(capture, /XL_GPS_MIN_INTERVAL_MS = 3000/);
  assert.match(capture, /Number\.isFinite\(fix\.latitude\)/);
  assert.match(capture, /planXlDriverEvent/);
  assert.match(screen, /recordXlDriverAction/);
  assert.match(screen, /progress_reconciled/);
  assert.match(screen, /installXlGpsCapture/);
  assert.match(http, /rejected/);
  assert.match(http, /open_guinea_xl_segment_departure/);
});

async function runProgressTests() {
  for (const item of tests) {
    try {
      await item.fn();
      console.log(`ok ${item.name}`);
    } catch (error) {
      console.error(`FAIL ${item.name}`);
      throw error;
    }
  }
  console.log("guineaXlSegmentProgress.test.ts passed");
}

runProgressTests().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
