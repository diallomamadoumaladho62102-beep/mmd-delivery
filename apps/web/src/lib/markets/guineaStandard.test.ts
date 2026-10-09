import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { calculateGuineaTaxiFareGnf, readGuineaTaxiRateCard } from "@/lib/markets/guineaTaxiPricing";
import { loadCommercialConfig } from "@/lib/markets/guineaTaxiHttp";
import { hasPermission } from "@/lib/adminRbac";
import {
  cancelGuineaPoolReservation,
  chooseGuineaPoolProposal,
  declineGuineaPoolProposal,
  evaluateGuineaPool,
  filterGuineaPoolSearchRows,
  freezeGuineaStandardSnapshot,
  guineaPoolSearchBounds,
  guineaStandardDistanceAllowed,
  guineaStandardSaveConflicts,
  guineaStopOrderValid,
  planGuineaStandardPool,
  readGuineaPoolLimits,
  readGuineaStandardCommissionBps,
  resolveGuineaPassengerCount,
  resolveGuineaStandardVehicle,
  splitGuineaStandardCommission,
  validateGuineaStandardSettings,
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

test("a configured 5000 GNF minimum is a floor and not the price per kilometer", () => {
  const card = {
    baseFareGnf: 1_000,
    perKmGnf: 100,
    perMinuteGnf: 10,
    minimumFareGnf: 5_000,
    maximumFareGnf: null,
  };
  const shortTrip = calculateGuineaTaxiFareGnf({
    distanceMeters: 1_000,
    durationMinutes: 1,
    card,
  });
  assert.equal(shortTrip.ok && shortTrip.fareGnf, 5_000);
  const longer = calculateGuineaTaxiFareGnf({
    distanceMeters: 45_000,
    durationMinutes: 54,
    card,
  });
  assert.equal(longer.ok && longer.fareGnf, 1_000 + 4_500 + 540);
  assert.notEqual(longer.ok && longer.fareGnf, 77_000);
  const pricing = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "guineaTaxiPricing.ts"),
    "utf8",
  );
  assert.equal(pricing.includes("5000"), false);
  assert.equal(pricing.includes("5_000"), false);
  assert.equal(readGuineaTaxiRateCard({}).ok, false);
});

test("live pooling stays solo until thresholds and a compared route exist", () => {
  assert.equal(readGuineaPoolLimits({}), null);
  const first = planGuineaStandardPool({
    sharedRide: true,
    vehicle: "car",
    limits: null,
    compared: null,
  });
  assert.equal(first.action, "solo");
  if (first.action === "solo") assert.equal(first.reason, "guinea_pool_not_configured");
  const waiting = planGuineaStandardPool({
    sharedRide: true,
    vehicle: "car",
    limits: LIMITS,
    compared: null,
  });
  assert.equal(waiting.action, "solo");
  const joined = planGuineaStandardPool({
    sharedRide: true,
    vehicle: "car",
    limits: LIMITS,
    compared: {
      existing: [seat("a", 77_000)],
      incomingPassengers: 1,
      detourMeters: 500,
      extraMinutes: 3,
      pickupDeviationMeters: 200,
      oppositeDirection: false,
      driverOnline: true,
      poolable: true,
    },
  });
  assert.equal(joined.action, "join");
  assert.equal(seat("a", 77_000).fareGnf, 77_000);
});

test("standard http does not hardcode the commercial percentage", () => {
  const http = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "guineaTaxiHttp.ts"),
    "utf8",
  );
  const pricing = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "guineaTaxiPricing.ts"),
    "utf8",
  );
  assert.equal(http.includes("platform_fee_cents: 0"), false);
  assert.equal(http.includes("0.15"), false);
  assert.equal(http.includes("GUINEA_TAXI_PLATFORM_SHARE_BPS"), false);
  assert.match(http, /readGuineaStandardCommissionBps/);
  assert.match(http, /guinea_standard_settings/);
  for (const source of [pricing, http]) {
    assert.equal(/baseFareGnf\s*[:=]\s*1_?000/.test(source), false);
    assert.equal(/perKmGnf\s*[:=]\s*2_?000/.test(source), false);
    assert.equal(/perMinuteGnf\s*[:=]\s*500\b/.test(source), false);
    assert.equal(/minimumFareGnf\s*[:=]\s*5_?000/.test(source), false);
    assert.equal(/platformShareBps\s*[:=]\s*1_?500/.test(source), false);
    assert.equal(source.includes("?? 1000"), false);
    assert.equal(source.includes("?? 5000"), false);
  }
  const migration = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../../supabase/migrations/20261220120000_guinea_standard_settings.sql"),
    "utf8",
  );
  assert.match(migration, /1000, 2000, 500, 5000, 1500/);
  assert.match(migration, /on conflict \(id\) do nothing/);
});

test("authorized standard card is simulated without replacing the old references", () => {
  const card = {
    baseFareGnf: 1000,
    perKmGnf: 2000,
    perMinuteGnf: 500,
    minimumFareGnf: 5000,
    maximumFareGnf: null,
  };
  const trips = [
    { km: 1, minutes: 1.2, oldFare: 10_000 },
    { km: 45, minutes: 54, oldFare: 77_000 },
    { km: 80, minutes: 96, oldFare: 181_000 },
    { km: 100, minutes: 120, oldFare: 265_000 },
  ];
  const results = trips.map((trip) => {
    const quoted = calculateGuineaTaxiFareGnf({
      distanceMeters: trip.km * 1000,
      durationMinutes: trip.minutes,
      card,
    });
    if (quoted.ok === false) throw new Error("quote failed");
    const distanceComponent = Math.round((card.perKmGnf * trip.km * 1000) / 1000);
    const timeComponent = card.perMinuteGnf * quoted.durationMinutes;
    const beforeMinimum = card.baseFareGnf + distanceComponent + timeComponent;
    return {
      ...trip,
      roundedMinutes: quoted.durationMinutes,
      distanceComponent,
      timeComponent,
      beforeMinimum,
      minimumApplied: beforeMinimum < card.minimumFareGnf,
      finalFare: quoted.fareGnf,
    };
  });
  assert.deepEqual(
    results.map((row) => [row.roundedMinutes, row.beforeMinimum, row.minimumApplied, row.finalFare]),
    [
      [1, 3500, true, 5000],
      [54, 118000, false, 118000],
      [96, 209000, false, 209000],
      [120, 261000, false, 261000],
    ],
  );
  assert.deepEqual(
    results.map((row) => row.finalFare - row.oldFare),
    [-5000, 41000, 28000, -4000],
  );
  for (const row of results) {
    const split = splitGuineaStandardCommission(row.finalFare, 1500);
    assert.ok(split);
    assert.equal(split.platformFeeGnf + split.driverAmountGnf, row.finalFare);
  }
  const short = splitGuineaStandardCommission(5000, 1500);
  const mid = splitGuineaStandardCommission(118000, 1500);
  assert.equal(short?.platformFeeGnf, 750);
  assert.equal(short?.driverAmountGnf, 4250);
  assert.equal(mid?.platformFeeGnf, 17700);
  assert.equal(mid?.driverAmountGnf, 100300);
});

test("standard settings reject invalid amounts and unauthorized writers", () => {
  assert.equal(validateGuineaStandardSettings({
    baseFareGnf: 1000,
    perKmGnf: 2000,
    perMinuteGnf: 500,
    minimumFareGnf: 5000,
    platformShareBps: 1500,
  }).ok, true);
  assert.equal(validateGuineaStandardSettings({
    baseFareGnf: -1,
    perKmGnf: 2000,
    perMinuteGnf: 500,
    minimumFareGnf: 5000,
    platformShareBps: 1500,
  }).ok, false);
  assert.equal(validateGuineaStandardSettings({
    baseFareGnf: 1.5,
    perKmGnf: 2000,
    perMinuteGnf: 500,
    minimumFareGnf: 5000,
    platformShareBps: 1500,
  }).ok, false);
  assert.equal(
    validateGuineaStandardSettings({
      baseFareGnf: 1000,
      perKmGnf: 2000,
      perMinuteGnf: 500,
      minimumFareGnf: 5000,
      platformShareBps: 10001,
    }).ok,
    false,
  );
  assert.equal(hasPermission("super_admin", "taxi_pricing.write"), true);
  assert.equal(hasPermission("finance_admin", "taxi_pricing.read"), true);
  assert.equal(hasPermission("finance_admin", "taxi_pricing.write"), false);
  assert.equal(hasPermission("operations_admin", "taxi_pricing.write"), false);
  assert.equal(hasPermission("client", "taxi_pricing.read"), false);
  const route = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../app/api/admin/guinea-standard/route.ts"),
    "utf8",
  );
  assert.match(route, /taxi_pricing\.read/);
  assert.match(route, /assertCanWriteTaxiPricing/);
  assert.equal(/base_fare_gnf:\s*1000/.test(route), false);
  assert.equal(/per_km_gnf:\s*2000/.test(route), false);
  assert.equal(/minimum_fare_gnf:\s*5000/.test(route), false);
  assert.equal(/platform_share_bps:\s*1500/.test(route), false);
});

function settingsClient(result: { data: unknown; error: { message: string } | null }) {
  const chain = {
    select() {
      return chain;
    },
    eq() {
      return chain;
    },
    maybeSingle: async () => result,
  };
  return { from: () => chain };
}

test("server reads the saved standard row and fails closed without it", async () => {
  const saved = await loadCommercialConfig(
    settingsClient({
      data: {
        base_fare_gnf: 1000,
        per_km_gnf: 2000,
        per_minute_gnf: 500,
        minimum_fare_gnf: 5000,
        maximum_fare_gnf: null,
        platform_share_bps: 1500,
      },
      error: null,
    }) as never,
  );
  assert.equal(saved.ok, true);
  if (saved.ok) {
    assert.equal(saved.source, "database");
    assert.equal(saved.card.baseFareGnf, 1000);
    assert.equal(saved.card.perKmGnf, 2000);
    assert.equal(saved.bps, 1500);
  }
  const edited = await loadCommercialConfig(
    settingsClient({
      data: {
        base_fare_gnf: 2500,
        per_km_gnf: 3000,
        per_minute_gnf: 700,
        minimum_fare_gnf: 8000,
        maximum_fare_gnf: null,
        platform_share_bps: 1200,
      },
      error: null,
    }) as never,
  );
  assert.equal(edited.ok && edited.card.baseFareGnf, 2500);
  assert.equal(edited.ok && edited.card.perKmGnf, 3000);
  const invalid = await loadCommercialConfig(
    settingsClient({
      data: {
        base_fare_gnf: 1.5,
        per_km_gnf: 2000,
        per_minute_gnf: 500,
        minimum_fare_gnf: 5000,
        maximum_fare_gnf: null,
        platform_share_bps: 1500,
      },
      error: null,
    }) as never,
  );
  assert.equal(invalid.ok, false);
  const absent = await loadCommercialConfig(
    settingsClient({ data: null, error: { message: "relation guinea_standard_settings does not exist" } }) as never,
  );
  assert.equal(absent.ok, false);
  assert.equal(absent.ok === false && absent.error, "guinea_pricing_not_configured");
});

test("pooling search stays inside one pickup box and does not join without approved thresholds", () => {
  const bounds = guineaPoolSearchBounds(9.6412, -13.5784, 800);
  assert.ok(bounds);
  const far = {
    id: "kankan",
    countryCode: "GN",
    currency: "GNF",
    vehicleClass: "standard",
    status: "dispatching",
    paymentStatus: "pending_cash",
    paymentMethod: "cash",
    pickupLat: 10.385,
    pickupLng: -9.306,
  };
  const near = { ...far, id: "near", pickupLat: 9.6412, pickupLng: -13.5784 };
  const usa = { ...near, id: "usa", countryCode: "US", currency: "USD" };
  const moto = { ...near, id: "moto", vehicleClass: "motorcycle" };
  const rows = [far, near, usa, moto, ...Array.from({ length: 30 }, (_, index) => ({ ...near, id: `n${index}` }))];
  const found = filterGuineaPoolSearchRows({ rows, bounds: bounds!, limit: 50 });
  assert.equal(found.some((row) => row.id === "kankan"), false);
  assert.equal(found.some((row) => row.id === "usa" || row.id === "moto"), false);
  assert.equal(found.length, 20);
  assert.equal(found[0]?.id, "near");

  const inactive = chooseGuineaPoolProposal({
    sharedRide: true,
    vehicle: "car",
    limits: null,
    incomingPassengers: 1,
    candidates: [],
    nowMs: 1_000,
  });
  assert.equal(inactive.action, "solo");
  const proposal = chooseGuineaPoolProposal({
    sharedRide: true,
    vehicle: "car",
    limits: LIMITS,
    incomingPassengers: 1,
    nowMs: 1_000,
    candidates: [
      {
        id: "ride-a",
        passengerCount: 1,
        fareGnf: 118_000,
        detourMeters: 400,
        extraMinutes: 4,
        pickupDeviationMeters: 200,
        oppositeDirection: false,
        driverOnline: true,
        poolable: true,
        proposalExpiresAtMs: 2_000,
      },
    ],
  });
  assert.equal(proposal.action, "propose");
  if (proposal.action === "propose") assert.equal(proposal.keptFareGnf, 118_000);
  const full = chooseGuineaPoolProposal({
    sharedRide: true,
    vehicle: "car",
    limits: LIMITS,
    incomingPassengers: 1,
    nowMs: 1_000,
    candidates: [
      {
        id: "full",
        passengerCount: 4,
        fareGnf: 50_000,
        detourMeters: 100,
        extraMinutes: 1,
        pickupDeviationMeters: 100,
        oppositeDirection: false,
        driverOnline: true,
        poolable: true,
        proposalExpiresAtMs: 2_000,
      },
    ],
  });
  assert.equal(full.action, "refuse");
  const primary = seat("main", 209_000);
  const declined = declineGuineaPoolProposal([primary, seat("offer", 5_000)], "offer");
  assert.equal(declined.find((row) => row.id === "main")?.status, "confirmed");
  assert.equal(declined.find((row) => row.id === "main")?.fareGnf, 209_000);
  assert.equal(declined.find((row) => row.id === "offer")?.status, "canceled");
  const http = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "guineaTaxiHttp.ts"),
    "utf8",
  );
  assert.match(http, /candidates:\s*\[\]/);
  assert.match(http, /payment_funding:\s*"cash"/);
  const adminRoute = fs.readFileSync(
    path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../app/api/admin/guinea-standard/route.ts"),
    "utf8",
  );
  assert.match(adminRoute, /guinea_rate_conflict/);
  assert.match(adminRoute, /\.eq\("updated_at"/);
  assert.equal(guineaStandardSaveConflicts("2026-10-09T00:00:00.000Z", "2026-10-09T00:00:00.000Z"), false);
  assert.equal(guineaStandardSaveConflicts("2026-10-09T00:00:00.000Z", "2026-10-09T00:00:01.000Z"), true);
  assert.equal(guineaStandardSaveConflicts("2026-10-09T00:00:00.000Z", null), true);
});

console.log("guineaStandard.test.ts passed");
