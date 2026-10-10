import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { XL_SEGMENT_LOCAL_ESTIMATES } from "@/lib/markets/guineaXlSegmentCatalog";
import {
  dispatchLimitsFromRow,
  freeSeatsOnSegmentPath,
  planXlSegmentDeparture,
  selectXlSegmentDriver,
  type XlDispatchDeparture,
  type XlDispatchLimits,
} from "@/lib/markets/guineaXlSegmentDispatch";
import { quoteXlSegmentRoute, XL_SEGMENT_COMMERCIAL_BOOKING_ENABLED } from "@/lib/markets/guineaXlSegments";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const nowMs = 1_700_000_000_000;
const limits: XlDispatchLimits = {
  maxPickupMeters: 400_000,
  maxDetourMeters: 20_000,
  maxPickupDelayMinutes: 30,
  maxLocationAgeMs: 10 * 60_000,
};

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function corridor(codes: string[]): XlDispatchDeparture["segments"] {
  return XL_SEGMENT_LOCAL_ESTIMATES.filter((segment) => codes.includes(segment.code)).map((segment) => ({
    code: segment.code,
    branch: segment.branch,
    distanceKm: segment.distanceKm,
    durationMinutes: segment.durationMinutes,
  }));
}

function departure(patch: Partial<XlDispatchDeparture> & Pick<XlDispatchDeparture, "id" | "driverId">): XlDispatchDeparture {
  return {
    status: "open",
    driverAvailable: true,
    capacity: 4,
    scheduledAtMs: nowMs,
    segments: corridor(["1", "2", "3", "4", "5"]),
    progress: "at",
    passedSegmentCodes: ["1", "2", "3"],
    holds: [],
    locationUpdatedAtMs: nowMs - 60_000,
    road: { distanceMeters: 12_000, etaMinutes: 18 },
    ...patch,
  };
}

function choose(departures: XlDispatchDeparture[], origin = "Dalaba", destination = "Pita", extra?: Partial<Parameters<typeof selectXlSegmentDriver>[0]>) {
  return selectXlSegmentDriver({
    segments: XL_SEGMENT_LOCAL_ESTIMATES,
    originLabel: origin,
    destinationLabel: destination,
    requestedPickupAtMs: nowMs,
    nowMs,
    limits,
    departures,
    ...extra,
  });
}

test("a close driver on the route is chosen and a closer driver going elsewhere is not", () => {
  const selected = choose([
    departure({ id: "on-route", driverId: "driver-a", road: { distanceMeters: 12_000, etaMinutes: 18 } }),
    departure({
      id: "wrong-way",
      driverId: "driver-b",
      segments: corridor(["1", "2"]),
      passedSegmentCodes: [],
      road: { distanceMeters: 800, etaMinutes: 2 },
    }),
  ]);
  if (selected.ok === false) throw new Error("driver");
  assert.equal(selected.driverId, "driver-a");
  assert.equal(selected.seatIndex, 1);
  assert.deepEqual(selected.segmentCodes, ["4"]);
  assert.equal(selected.commercialBooking, false);
  const wrongWay = choose([
    departure({
      id: "wrong-way",
      driverId: "driver-b",
      segments: corridor(["1", "2"]),
      passedSegmentCodes: [],
      road: { distanceMeters: 800, etaMinutes: 2 },
    }),
  ]);
  assert.equal(wrongWay.ok, false);
  if (wrongWay.ok) return;
  assert.equal(wrongWay.rejected[0]?.reason, "xl_driver_wrong_direction");
});

test("an admissible driver beyond the pickup limit is refused", () => {
  const selected = choose([
    departure({ id: "far", driverId: "driver-far", road: { distanceMeters: 450_000, etaMinutes: 10 } }),
  ]);
  assert.equal(selected.ok, false);
  if (selected.ok) return;
  assert.equal(selected.rejected[0]?.reason, "xl_driver_too_far");
  const detour = choose([
    departure({ id: "aside", driverId: "driver-aside", road: { distanceMeters: 25_000, etaMinutes: 10 } }),
  ]);
  assert.equal(detour.ok, false);
  if (detour.ok) return;
  assert.equal(detour.rejected[0]?.reason, "xl_detour_exceeded");
});

test("a seat is free only when every requested segment is free", () => {
  const heldOnPita = departure({
    id: "held",
    driverId: "driver-a",
    capacity: 1,
    holds: [{ seatIndex: 1, segmentCodes: ["4"], blocksSeat: false }],
  });
  assert.deepEqual(freeSeatsOnSegmentPath({ capacity: 1, holds: heldOnPita.holds, segmentCodes: ["4"] }), []);
  assert.deepEqual(freeSeatsOnSegmentPath({ capacity: 1, holds: heldOnPita.holds, segmentCodes: ["5"] }), [1]);
  const toLabe = choose([heldOnPita], "Dalaba", "Labé");
  assert.equal(toLabe.ok, false);
  if (toLabe.ok) return;
  assert.equal(toLabe.rejected[0]?.reason, "xl_seat_taken");
});

test("two passengers can follow each other when their portions do not overlap", () => {
  const first = choose([
    departure({
      id: "run",
      driverId: "driver-a",
      holds: [{ seatIndex: 1, segmentCodes: ["1", "2"], blocksSeat: false }],
    }),
  ]);
  assert.equal(first.ok && first.seatIndex, 1);
  const second = choose([
    departure({
      id: "run",
      driverId: "driver-a",
      holds: [
        { seatIndex: 1, segmentCodes: ["1", "2"], blocksSeat: false },
        { seatIndex: 1, segmentCodes: ["4"], blocksSeat: false },
      ],
    }),
  ]);
  assert.equal(second.ok && second.seatIndex, 2);
});

test("two requests on the same snapshot both see the last seat", () => {
  const onlySeat = departure({ id: "last", driverId: "driver-a", capacity: 1 });
  const left = choose([onlySeat]);
  const right = choose([onlySeat]);
  assert.equal(left.ok && left.seatIndex, 1);
  assert.equal(right.ok && right.seatIndex, 1);
  const afterHold = choose([
    departure({
      id: "last",
      driverId: "driver-a",
      capacity: 1,
      holds: [{ seatIndex: 1, segmentCodes: ["4"], blocksSeat: false }],
    }),
  ]);
  assert.equal(afterHold.ok, false);
});

test("the closest road arrival wins among several admissible drivers", () => {
  const selected = choose([
    departure({ id: "slower", driverId: "slow", road: { distanceMeters: 8_000, etaMinutes: 40 } }),
    departure({ id: "faster", driverId: "fast", road: { distanceMeters: 15_000, etaMinutes: 12 } }),
  ]);
  assert.equal(selected.ok && selected.driverId, "fast");
});

test("a stale or missing position is not invented", () => {
  const stale = choose([
    departure({ id: "stale", driverId: "driver-a", locationUpdatedAtMs: nowMs - limits.maxLocationAgeMs - 1 }),
  ]);
  assert.equal(stale.ok, false);
  if (stale.ok) return;
  assert.equal(stale.rejected[0]?.reason, "xl_driver_location_unavailable");
  const missing = choose([departure({ id: "none", driverId: "driver-a", locationUpdatedAtMs: null, road: null })]);
  assert.equal(missing.ok, false);
});

test("finished, canceled, and unavailable drivers are excluded", () => {
  for (const [status, reason] of [
    ["completed", "xl_departure_completed"],
    ["canceled", "xl_departure_canceled"],
  ] as const) {
    const selected = choose([departure({ id: status, driverId: "driver-a", status })]);
    assert.equal(selected.ok, false);
    if (selected.ok) continue;
    assert.equal(selected.rejected[0]?.reason, reason);
  }
  const unavailable = choose([departure({ id: "off", driverId: "driver-a", driverAvailable: false })]);
  assert.equal(unavailable.ok, false);
  if (unavailable.ok) return;
  assert.equal(unavailable.rejected[0]?.reason, "xl_driver_unavailable");
});

test("a new position or a new hold changes the selection", () => {
  const before = choose([
    departure({ id: "a", driverId: "a", road: { distanceMeters: 10_000, etaMinutes: 20 } }),
    departure({ id: "b", driverId: "b", road: { distanceMeters: 11_000, etaMinutes: 25 } }),
  ]);
  assert.equal(before.ok && before.driverId, "a");
  const moved = choose([
    departure({ id: "a", driverId: "a", road: { distanceMeters: 30_000, etaMinutes: 50 } }),
    departure({ id: "b", driverId: "b", road: { distanceMeters: 9_000, etaMinutes: 11 } }),
  ]);
  assert.equal(moved.ok && moved.driverId, "b");
  const taken = choose([
    departure({
      id: "a",
      driverId: "a",
      capacity: 1,
      holds: [{ seatIndex: 1, segmentCodes: ["4"], blocksSeat: false }],
    }),
    departure({ id: "b", driverId: "b" }),
  ]);
  assert.equal(taken.ok && taken.driverId, "b");
});

test("an axis hold blocks the seat for a segment passenger", () => {
  const selected = choose([
    departure({
      id: "axis",
      driverId: "driver-a",
      capacity: 1,
      holds: [{ seatIndex: 1, segmentCodes: [], blocksSeat: true }],
    }),
  ]);
  assert.equal(selected.ok, false);
  if (selected.ok) return;
  assert.equal(selected.rejected[0]?.reason, "xl_seat_taken");
});

test("the same request returns the same driver and does not change the fare", () => {
  const input = [departure({ id: "stable", driverId: "driver-a" })];
  assert.deepEqual(choose(input), choose(input));
  const fare = quoteXlSegmentRoute({
    segments: XL_SEGMENT_LOCAL_ESTIMATES,
    originLabel: "Dalaba",
    destinationLabel: "Pita",
    tariff: { version: 1, baseGnf: 1_000, perKmGnf: 500, perMinuteGnf: 100, minimumGnf: 30_000 },
    mode: "local",
  });
  assert.equal(fare.ok && fare.totalGnf, 32_200);
  assert.equal(XL_SEGMENT_COMMERCIAL_BOOKING_ENABLED, false);
});

test("a segment departure follows the stored path and does not invent an axis", () => {
  const planned = planXlSegmentDeparture(XL_SEGMENT_LOCAL_ESTIMATES, "Conakry", "Labé");
  if (planned.ok === false) throw new Error(planned.error);
  assert.deepEqual(planned.segmentCodes, ["1", "2", "3", "4", "5"]);
  assert.equal(planned.axisId, null);
  const reverse = planXlSegmentDeparture(XL_SEGMENT_LOCAL_ESTIMATES, "Kindia", "Conakry");
  assert.equal(reverse.ok, false);
  const stopped = XL_SEGMENT_LOCAL_ESTIMATES.map((segment) =>
    segment.code === "4" ? { ...segment, active: false } : segment,
  );
  const inactive = planXlSegmentDeparture(stopped, "Dalaba", "Pita");
  assert.equal(inactive.ok, false);
  if (inactive.ok) return;
  assert.equal(inactive.error, "xl_segment_inactive");
});

test("missing dispatch limits stay missing", () => {
  assert.equal(dispatchLimitsFromRow(null), null);
  assert.equal(dispatchLimitsFromRow({ max_pickup_meters: 1, max_detour_meters: 1, max_pickup_delay_minutes: 1 }), null);
  const selected = choose([departure({ id: "a", driverId: "a" })], "Dalaba", "Pita", { limits: null });
  assert.equal(selected.ok, false);
  if (selected.ok) return;
  assert.equal(selected.error, "xl_dispatch_not_configured");
});

test("dispatch does not replace taxi, standard, or food dispatch", () => {
  const dispatch = fs.readFileSync(path.join(root, "apps/web/src/lib/markets/guineaXlSegmentDispatch.ts"), "utf8");
  assert.equal(dispatch.includes("milesBetween"), false);
  assert.equal(/haversine/i.test(dispatch), false);
  assert.equal(/maxPickupMeters\s*=\s*\d/.test(dispatch), false);
  assert.equal(dispatch.includes("450000"), false);
  const route = fs.readFileSync(path.join(root, "apps/web/app/api/admin/guinea-xl/route.ts"), "utf8");
  assert.match(route, /assertStaffPermission\("taxi_pricing.read"/);
  assert.match(route, /assertCanWriteTaxiPricing/);
  assert.match(route, /save_segment_dispatch/);
  const http = fs.readFileSync(path.join(root, "apps/web/src/lib/markets/guineaXlHttp.ts"), "utf8");
  assert.match(http, /segment_run: true/);
  assert.match(http, /axisId: null/);
  assert.match(http, /axis_id: String\(body\.axisId/);
  assert.match(http, /loadXlSegmentDispatchMatch/);
  assert.match(http, /getDrivingLeg/);
  assert.match(http, /segmentCommercialBookingEnabled\(\)/);
  assert.match(http, /open_guinea_xl_segment_departure/);
  assert.match(dispatch, /establishXlSegmentProgress/);
  assert.equal(dispatch.includes("passedSegmentCodes: []"), false);
  assert.equal(http.includes(".delete()"), false);
  assert.equal(http.includes("milesBetween"), false);
  for (const relative of [
    "apps/web/src/lib/runTaxiRideDispatch.ts",
    "apps/web/src/lib/markets/guineaTaxiHttp.ts",
    "apps/web/src/lib/markets/guineaStandard.ts",
    "apps/web/src/lib/mapboxRoute.ts",
  ]) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    assert.equal(source.includes("guineaXlSegmentDispatch"), false, relative);
  }
  const pending = fs.readFileSync(path.join(root, "supabase/pending/20261019120000_guinea_xl_segment_dispatch.sql"), "utf8");
  assert.match(pending, /do not apply/i);
  assert.equal(/guinea_standard_settings/i.test(pending), false);
  assert.equal(/platform_share_bps/i.test(pending), false);
  assert.equal(/default\s+\d+/i.test(pending), false);
  assert.match(pending, /450000/);
  assert.match(pending, /30000/);
  assert.match(pending, /180/);
  assert.match(pending, /1200/);
  assert.match(pending, /max_pickup_meters is null/);
  const wide = choose(
    [departure({ id: "wide", driverId: "driver-a", road: { distanceMeters: 449_000, etaMinutes: 20 } })],
    "Dalaba",
    "Pita",
    { limits: { ...limits, maxPickupMeters: 450_000, maxDetourMeters: 500_000 } },
  );
  assert.equal(wide.ok, true);
  const overPickup = choose(
    [departure({ id: "over", driverId: "driver-a", road: { distanceMeters: 450_001, etaMinutes: 20 } })],
    "Dalaba",
    "Pita",
    { limits: { ...limits, maxPickupMeters: 450_000, maxDetourMeters: 500_000 } },
  );
  assert.equal(overPickup.ok, false);
  if (overPickup.ok) return;
  assert.equal(overPickup.rejected[0]?.reason, "xl_driver_too_far");
  const town = choose(
    [departure({ id: "town", driverId: "driver-a", road: { distanceMeters: 40_000, etaMinutes: 20 } })],
    "Dalaba",
    "Pita",
    { limits: { ...limits, maxPickupMeters: 25_000, maxDetourMeters: 500_000 } },
  );
  assert.equal(town.ok, false);
  if (town.ok) return;
  assert.equal(town.rejected[0]?.reason, "xl_driver_too_far");
});

console.log("guineaXlSegmentDispatch.test.ts passed");
