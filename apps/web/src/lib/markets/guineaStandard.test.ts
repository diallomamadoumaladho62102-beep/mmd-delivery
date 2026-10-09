import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calculateGuineaTaxiFareGnf } from "@/lib/markets/guineaTaxiPricing";
import {
  cancelGuineaPoolReservation,
  evaluateGuineaPool,
  freezeGuineaStandardSnapshot,
  guineaStandardDistanceAllowed,
  guineaStopOrderValid,
  readGuineaStandardCommissionBps,
  resolveGuineaPassengerCount,
  resolveGuineaStandardVehicle,
  splitGuineaStandardCommission,
  type GuineaPoolLimits,
  type GuineaPoolReservation,
} from "@/lib/markets/guineaStandard";

const LIMITS: GuineaPoolLimits = {
  maxDetourMeters: 3_000,
  maxExtraMinutes: 12,
  maxPickupDeviationMeters: 1_500,
};

function seat(id: string, fareGnf: number, passengerCount = 1): GuineaPoolReservation {
  return { id, status: "confirmed", passengerCount, fareGnf };
}

function propose(partial: Partial<Parameters<typeof evaluateGuineaPool>[0]> = {}) {
  return evaluateGuineaPool({
    vehicle: "car",
    driverOnline: true,
    poolable: true,
    existing: [],
    incomingPassengers: 1,
    detourMeters: 0,
    extraMinutes: 0,
    pickupDeviationMeters: 0,
    oppositeDirection: false,
    limits: LIMITS,
    ...partial,
  });
}

function test(name: string, fn: () => void) {
  fn();
  console.log(`ok ${name}`);
}

test("the linear fare cannot hit every validated reference at once", () => {
  const from45To80 = 181_000 - 77_000;
  const from80To100 = 265_000 - 181_000;
  const impliedByLongerLeg = (from80To100 / 20) * 35;
  assert.equal(from45To80, 104_000);
  assert.equal(from80To100, 84_000);
  assert.notEqual(from45To80, impliedByLongerLeg);
  const card = {
    baseFareGnf: 0,
    perKmGnf: 4_200,
    perMinuteGnf: 0,
    minimumFareGnf: 10_000,
    maximumFareGnf: null,
  };
  const eighty = calculateGuineaTaxiFareGnf({
    distanceMeters: 80_000,
    durationMinutes: 96,
    card,
  });
  const fortyFive = calculateGuineaTaxiFareGnf({
    distanceMeters: 45_000,
    durationMinutes: 54,
    card,
  });
  assert.equal(eighty.ok && eighty.fareGnf, 336_000);
  assert.notEqual(fortyFive.ok && fortyFive.fareGnf, 77_000);
});

test("commission comes from the supplied rate and splits the validated totals", () => {
  assert.equal(readGuineaStandardCommissionBps({}), null);
  assert.equal(readGuineaStandardCommissionBps({ GUINEA_TAXI_PLATFORM_SHARE_BPS: "1500" }), 1_500);
  for (const [fare, platform, driver] of [
    [77_000, 11_550, 65_450],
    [181_000, 27_150, 153_850],
    [265_000, 39_750, 225_250],
  ] as const) {
    const split = splitGuineaStandardCommission(fare, 1_500);
    assert.ok(split);
    assert.equal(split?.platformFeeGnf, platform);
    assert.equal(split?.driverAmountGnf, driver);
    assert.equal((split?.platformFeeGnf ?? 0) + (split?.driverAmountGnf ?? 0), fare);
  }
});

test("a confirmed snapshot keeps 77000 after the rate card changes", () => {
  const card = { baseFareGnf: 1_000, perKmGnf: 1_000, perMinuteGnf: 500, minimumFareGnf: 10_000, maximumFareGnf: null };
  const snapshot = freezeGuineaStandardSnapshot({
    distanceMeters: 45_000,
    durationMinutes: 54,
    fareGnf: 77_000,
    platformShareBps: 1_500,
    platformFeeGnf: 11_550,
    driverAmountGnf: 65_450,
    ...card,
    vehicle: "car",
    passengerCount: 1,
    quotedAt: "2026-10-09T00:00:00.000Z",
  });
  card.perKmGnf = 9_999;
  assert.equal(snapshot.fare_gnf, 77_000);
  assert.equal(snapshot.per_km_gnf, 1_000);
  assert.equal(snapshot.platform_fee_gnf + snapshot.driver_amount_gnf, 77_000);
});

test("car accepts one to four passengers and refuses a fifth", () => {
  assert.equal(resolveGuineaPassengerCount(1, "car").ok, true);
  assert.equal(resolveGuineaPassengerCount(4, "car").ok, true);
  assert.equal(resolveGuineaPassengerCount(5, "car").ok, false);
  assert.equal(resolveGuineaPassengerCount(4.2, "car").ok, false);
  const four = propose({ existing: [seat("a", 77_000), seat("b", 50_000), seat("c", 40_000)], incomingPassengers: 1 });
  assert.equal(four.ok, true);
  const five = propose({ existing: [seat("a", 77_000, 4)], incomingPassengers: 1 });
  assert.equal(five.ok, false);
  if (five.ok === false) assert.equal(five.error, "guinea_capacity_exceeded");
  assert.equal(seat("a", 77_000).fareGnf, 77_000);
});

test("a motorcycle takes one passenger and cannot pool", () => {
  assert.equal(resolveGuineaStandardVehicle("moto").ok, true);
  assert.equal(resolveGuineaPassengerCount(1, "motorcycle").ok, true);
  assert.equal(resolveGuineaPassengerCount(2, "motorcycle").ok, false);
  const pooled = propose({ vehicle: "motorcycle", existing: [seat("a", 10_000)] });
  assert.equal(pooled.ok, false);
  if (pooled.ok === false) assert.equal(pooled.error, "guinea_motorcycle_pool_forbidden");
});

test("compatible car pools stay separate and a refusal keeps the first fare", () => {
  const first = seat("a", 77_000);
  const added = propose({ existing: [first], incomingPassengers: 1, detourMeters: 800, extraMinutes: 4 });
  assert.equal(added.ok, true);
  assert.equal(first.fareGnf, 77_000);
  assert.equal(propose({ existing: [first], oppositeDirection: true }).ok, false);
  assert.equal(propose({ existing: [first], detourMeters: 9_000 }).ok, false);
  assert.equal(propose({ existing: [first], extraMinutes: 30 }).ok, false);
  assert.equal(propose({ existing: [first], pickupDeviationMeters: 4_000 }).ok, false);
  assert.equal(propose({ existing: [first], driverOnline: false }).ok, false);
  assert.equal(propose({ existing: [first], poolable: false }).ok, false);
  assert.equal(first.status, "confirmed");
});

test("cancelling one reservation frees a seat and leaves the other fare", () => {
  const rows = [seat("a", 77_000), seat("b", 181_000)];
  const next = cancelGuineaPoolReservation(rows, "b");
  assert.equal(next[0]?.status, "confirmed");
  assert.equal(next[0]?.fareGnf, 77_000);
  assert.equal(next[1]?.status, "canceled");
  assert.equal(next[1]?.fareGnf, 181_000);
  const again = propose({ existing: next, incomingPassengers: 1 });
  assert.equal(again.ok, true);
  if (again.ok) assert.equal(again.activePassengers, 2);
});

test("stop order keeps every pickup before its own dropoff", () => {
  assert.equal(
    guineaStopOrderValid([
      { reservationId: "a", kind: "pickup" },
      { reservationId: "b", kind: "pickup" },
      { reservationId: "a", kind: "dropoff" },
      { reservationId: "b", kind: "dropoff" },
    ]),
    true,
  );
  assert.equal(
    guineaStopOrderValid([
      { reservationId: "a", kind: "dropoff" },
      { reservationId: "a", kind: "pickup" },
    ]),
    false,
  );
});

test("standard pricing stops above 100 km and still prices 100 km", () => {
  assert.equal(guineaStandardDistanceAllowed(100_000), true);
  assert.equal(guineaStandardDistanceAllowed(100_001), false);
  assert.equal(guineaStandardDistanceAllowed(1_000), true);
});

test("standard http does not hardcode the commercial percentage", () => {
  const http = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "guineaTaxiHttp.ts"),
    "utf8",
  );
  assert.equal(http.includes("platform_fee_cents: 0"), false);
  assert.equal(http.includes("0.15"), false);
  assert.equal(http.includes("GUINEA_TAXI_PLATFORM_SHARE_BPS"), false);
  assert.match(http, /readGuineaStandardCommissionBps/);
});

console.log("guineaStandard.test.ts passed");
