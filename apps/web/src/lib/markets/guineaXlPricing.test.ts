import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  bookXlSeats,
  collectXlCash,
  completeXlDeparture,
  emptyXlStore,
  openXlDeparture,
  replaceXlRate,
  type XlStore,
} from "@/lib/markets/guineaXlBooking";
import {
  buildXlSeats,
  canonicalRouteKey,
  findActiveXlAxis,
  localityKey,
  quoteXlReservation,
  reserveXlSeats,
  splitTransportCommission,
  type XlAxisRecord,
  type XlBaggageBand,
} from "@/lib/markets/guineaXlPricing";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

const VALIDATED_BANDS: XlBaggageBand[] = [
  { id: "backpack", minKg: 1, maxKg: 5, priceGnf: 0, active: true },
  { id: "to-10", minKg: 6, maxKg: 10, priceGnf: 30_000, active: true },
  { id: "to-20", minKg: 11, maxKg: 20, priceGnf: 40_000, active: true },
  { id: "to-30", minKg: 21, maxKg: 30, priceGnf: 55_000, active: true },
  { id: "to-100", minKg: 31, maxKg: 100, priceGnf: 100_000, active: true },
];

function labeAxis(front = 300_000, other = 250_000, versionId = "v1"): XlAxisRecord {
  const origin = localityKey("Conakry") ?? "";
  const destination = localityKey("Labé") ?? "";
  return {
    id: "axis-labe",
    originKey: origin,
    destinationKey: destination,
    routeKey: canonicalRouteKey(origin, destination),
    directional: false,
    active: true,
    rate: { versionId, frontSeatGnf: front, otherSeatGnf: other, active: true },
  };
}

function storeWithLabe(front = 300_000, other = 250_000): XlStore {
  const store = emptyXlStore();
  store.platformShareBps = 1_000;
  store.bands = VALIDATED_BANDS;
  store.axes = [labeAxis(front, other)];
  return store;
}

function seats(count: number, front = true): number[] {
  const indexes = front ? [1] : [];
  for (let index = 2; indexes.length < count; index += 1) indexes.push(index);
  return indexes;
}

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("commercial amounts stay out of the pricing module", () => {
  const source = fs.readFileSync(
    path.join(root, "apps/web/src/lib/markets/guineaXlPricing.ts"),
    "utf8",
  );
  for (const token of ["300000", "300_000", "250000", "250_000", "100000", "80_000", "80000"]) {
    assert.equal(source.includes(token), false, token);
  }
  assert.equal(source.includes("platformShareBps = 1000"), false);
  assert.equal(source.includes("0.10"), false);
});

test("four passengers on the configured Labé axis price only reserved seats", () => {
  const quote = quoteXlReservation({
    detectedCountryCodes: ["GN", "GN"],
    claimedTotalGnf: 9_999_999,
    axis: labeAxis(),
    capacity: 7,
    seatIndexes: seats(4),
    baggage: [],
    bands: VALIDATED_BANDS,
    platformShareBps: 1_000,
  });
  assert.equal(quote.ok, false);
  const clean = quoteXlReservation({
    detectedCountryCodes: ["GN", "GN"],
    axis: labeAxis(),
    capacity: 7,
    seatIndexes: seats(4),
    baggage: [],
    bands: VALIDATED_BANDS,
    platformShareBps: 1_000,
  });
  assert.equal(clean.ok, true);
  if (clean.ok) {
    assert.equal(clean.quote.transportGnf, 1_050_000);
    assert.equal(clean.quote.totalGnf, 1_050_000);
    assert.equal(clean.quote.platformFeeGnf, 105_000);
    assert.equal(clean.quote.driverAmountGnf, 945_000);
    assert.equal(clean.quote.platformFeeGnf + clean.quote.driverAmountGnf, clean.quote.transportGnf);
  }
});

test("six passengers split 10 percent without a remainder", () => {
  const quote = quoteXlReservation({
    detectedCountryCodes: ["GN", "GN"],
    axis: labeAxis(),
    capacity: 7,
    seatIndexes: seats(6),
    baggage: [],
    bands: VALIDATED_BANDS,
    platformShareBps: 1_000,
  });
  assert.equal(quote.ok, true);
  if (quote.ok) {
    assert.equal(quote.quote.transportGnf, 1_550_000);
    assert.equal(quote.quote.platformFeeGnf, 155_000);
    assert.equal(quote.quote.driverAmountGnf, 1_395_000);
    assert.equal(quote.quote.platformFeeGnf + quote.quote.driverAmountGnf, quote.quote.transportGnf);
  }
});

test("a new rate does not rewrite a confirmed booking", () => {
  let store = storeWithLabe();
  const opened = openXlDeparture(store, {
    id: "dep-1",
    axisId: "axis-labe",
    driverId: "driver-1",
    capacity: 7,
  });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  store = opened.store;
  const first = bookXlSeats(store, {
    bookingId: "book-1",
    idempotencyKey: "idem-1",
    clientUserId: "client-1",
    departureId: "dep-1",
    detectedCountryCodes: ["GN", "GN"],
    originLabel: "Labé",
    destinationLabel: "Conakry",
    seatIndexes: seats(4),
    baggage: [],
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const changed = replaceXlRate(first.store, {
    actorId: "admin-1",
    axisId: "axis-labe",
    expectedVersionId: "v1",
    frontSeatGnf: 280_000,
    otherSeatGnf: 230_000,
    nextVersionId: "v2",
    hasWritePermission: true,
  });
  assert.equal(changed.ok, true);
  if (!changed.ok) return;
  const old = changed.store.bookings[0];
  assert.equal(old?.quote.totalGnf, 1_050_000);
  assert.equal(old?.quote.rateVersionId, "v1");
  const openedAgain = openXlDeparture(changed.store, {
    id: "dep-2",
    axisId: "axis-labe",
    driverId: "driver-1",
    capacity: 7,
  });
  assert.equal(openedAgain.ok, true);
  if (!openedAgain.ok) return;
  const second = bookXlSeats(openedAgain.store, {
    bookingId: "book-2",
    idempotencyKey: "idem-2",
    clientUserId: "client-2",
    departureId: "dep-2",
    detectedCountryCodes: ["GN", "GN"],
    originLabel: "Conakry",
    destinationLabel: "Labé",
    seatIndexes: seats(4),
    baggage: [],
  });
  assert.equal(second.ok, true);
  if (second.ok) {
    assert.equal(second.booking.quote.totalGnf, 970_000);
    assert.equal(second.booking.quote.rateVersionId, "v2");
    assert.equal(second.store.bookings[0]?.quote.totalGnf, 1_050_000);
  }
});

test("commission rate is data and an unauthorized edit is refused", () => {
  const split = splitTransportCommission(1_000_000, 1_500);
  assert.ok(split);
  assert.equal(split?.platformFeeGnf, 150_000);
  assert.equal(split?.driverAmountGnf, 850_000);
  const denied = replaceXlRate(storeWithLabe(), {
    actorId: "staff-read",
    axisId: "axis-labe",
    expectedVersionId: "v1",
    frontSeatGnf: 1,
    otherSeatGnf: 1,
    nextVersionId: "v2",
    hasWritePermission: false,
  });
  assert.equal(denied.ok, false);
  if (denied.ok === false) assert.equal(denied.error, "xl_pricing_forbidden");
  const conflict = replaceXlRate(storeWithLabe(), {
    actorId: "admin-1",
    axisId: "axis-labe",
    expectedVersionId: "stale",
    frontSeatGnf: 1,
    otherSeatGnf: 1,
    nextVersionId: "v2",
    hasWritePermission: true,
  });
  assert.equal(conflict.ok, false);
  if (conflict.ok === false) assert.equal(conflict.error, "xl_rate_conflict");
});

test("seat capacity stops at the declared vehicle and the same seat cannot be sold twice", () => {
  for (const capacity of [4, 5, 6, 7] as const) {
    assert.equal(buildXlSeats(capacity).length, capacity);
    assert.equal(buildXlSeats(capacity).filter((seat) => seat.role === "front").length, 1);
    const tooMany = quoteXlReservation({
      detectedCountryCodes: ["GN", "GN"],
      axis: labeAxis(),
      capacity,
      seatIndexes: seats(capacity + 1),
      baggage: [],
      bands: VALIDATED_BANDS,
      platformShareBps: 1_000,
    });
    assert.equal(tooMany.ok, false);
  }
  const unsupported = quoteXlReservation({
    detectedCountryCodes: ["GN", "GN"],
    axis: labeAxis(),
    capacity: 8,
    seatIndexes: [1],
    baggage: [],
    bands: VALIDATED_BANDS,
    platformShareBps: 1_000,
  });
  assert.equal(unsupported.ok, false);

  let store = storeWithLabe();
  const opened = openXlDeparture(store, {
    id: "dep-1",
    axisId: "axis-labe",
    driverId: "driver-1",
    capacity: 4,
  });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  store = opened.store;
  const first = bookXlSeats(store, {
    bookingId: "book-1",
    idempotencyKey: "idem-1",
    clientUserId: "client-1",
    departureId: "dep-1",
    detectedCountryCodes: ["GN", "GN"],
    originLabel: "Conakry",
    destinationLabel: "Labé",
    seatIndexes: [1, 2, 3],
    baggage: [],
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const lastFromStale = reserveXlSeats(store.departures[0]?.seats ?? [], [4], "book-2");
  const lastAfter = bookXlSeats(first.store, {
    bookingId: "book-2",
    idempotencyKey: "idem-2",
    clientUserId: "client-2",
    departureId: "dep-1",
    detectedCountryCodes: ["GN", "GN"],
    originLabel: "Conakry",
    destinationLabel: "Labé",
    seatIndexes: [4],
    baggage: [],
  });
  const raced = bookXlSeats(first.store, {
    bookingId: "book-3",
    idempotencyKey: "idem-3",
    clientUserId: "client-3",
    departureId: "dep-1",
    detectedCountryCodes: ["GN", "GN"],
    originLabel: "Conakry",
    destinationLabel: "Labé",
    seatIndexes: [4],
    baggage: [],
  });
  assert.equal(lastFromStale.ok, true);
  assert.equal(lastAfter.ok, true);
  if (lastAfter.ok) {
    const secondTry = bookXlSeats(lastAfter.store, {
      bookingId: "book-4",
      idempotencyKey: "idem-4",
      clientUserId: "client-4",
      departureId: "dep-1",
      detectedCountryCodes: ["GN", "GN"],
      originLabel: "Conakry",
      destinationLabel: "Labé",
      seatIndexes: [4],
      baggage: [],
    });
    assert.equal(secondTry.ok, false);
    if (secondTry.ok === false) assert.equal(secondTry.error, "xl_seat_taken");
  }
  assert.equal(raced.ok, true);
  if (lastAfter.ok && raced.ok) {
    const taken = lastAfter.store.departures[0]?.seats.filter((seat) => seat.bookingId).length;
    const other = raced.store.departures[0]?.seats.filter((seat) => seat.bookingId).length;
    assert.equal(taken, 4);
    assert.equal(other, 4);
    assert.equal(
      lastAfter.store.ledger.filter((entry) => entry.bookingId === "book-2").length,
      2,
    );
  }
});

test("baggage follows the configured bands and ignores a client price", () => {
  const cases: Array<[number, number]> = [
    [5, 0],
    [10, 30_000],
    [20, 40_000],
    [30, 55_000],
    [100, 100_000],
  ];
  for (const [weightKg, priceGnf] of cases) {
    const quote = quoteXlReservation({
      detectedCountryCodes: ["GN", "GN"],
      claimedBaggageGnf: 1,
      axis: labeAxis(),
      capacity: 4,
      seatIndexes: [2],
      baggage: [{ weightKg }],
      bands: VALIDATED_BANDS,
      platformShareBps: 1_000,
    });
    assert.equal(quote.ok, false);
    const clean = quoteXlReservation({
      detectedCountryCodes: ["GN", "GN"],
      axis: labeAxis(),
      capacity: 4,
      seatIndexes: [2],
      baggage: [{ weightKg }],
      bands: VALIDATED_BANDS,
      platformShareBps: 1_000,
    });
    assert.equal(clean.ok, true);
    if (clean.ok) {
      assert.equal(clean.quote.baggageGnf, priceGnf);
      assert.equal(clean.quote.transportGnf, 250_000);
      assert.equal(clean.quote.totalGnf, 250_000 + priceGnf);
    }
  }
  for (const weightKg of [0, -1, 101, Number.NaN, Number.POSITIVE_INFINITY]) {
    const quote = quoteXlReservation({
      detectedCountryCodes: ["GN", "GN"],
      axis: labeAxis(),
      capacity: 4,
      seatIndexes: [2],
      baggage: [{ weightKg }],
      bands: VALIDATED_BANDS,
      platformShareBps: 1_000,
    });
    assert.equal(quote.ok, false);
  }
});

test("missing, inactive and foreign points do not invent an XL fare", () => {
  const inactive = labeAxis();
  inactive.active = false;
  const closed = quoteXlReservation({
    detectedCountryCodes: ["GN", "GN"],
    axis: inactive,
    capacity: 4,
    seatIndexes: [1],
    baggage: [],
    bands: VALIDATED_BANDS,
    platformShareBps: 1_000,
  });
  assert.equal(closed.ok, false);
  if (closed.ok === false) assert.equal(closed.error, "xl_route_not_configured");
  const missing = findActiveXlAxis([labeAxis()], "Kindia", "Mamou");
  assert.equal(missing, null);
  const spoof = quoteXlReservation({
    detectedCountryCodes: ["US", "US"],
    claimedCountryCode: "GN",
    claimedCurrency: "GNF",
    axis: labeAxis(),
    capacity: 4,
    seatIndexes: [1],
    baggage: [],
    bands: VALIDATED_BANDS,
    platformShareBps: 1_000,
  });
  assert.equal(spoof.ok, false);
  if (spoof.ok === false) assert.equal(spoof.error, "market_mismatch");
  const currency = quoteXlReservation({
    detectedCountryCodes: ["GN", "GN"],
    claimedCurrency: "USD",
    axis: labeAxis(),
    capacity: 4,
    seatIndexes: [1],
    baggage: [],
    bands: VALIDATED_BANDS,
    platformShareBps: 1_000,
  });
  assert.equal(currency.ok, false);
  if (currency.ok === false) assert.equal(currency.error, "currency_mismatch");
  const unset = quoteXlReservation({
    detectedCountryCodes: ["GN", "GN"],
    axis: labeAxis(),
    capacity: 4,
    seatIndexes: [1],
    baggage: [],
    bands: VALIDATED_BANDS,
    platformShareBps: null,
  });
  assert.equal(unset.ok, false);
});

test("repeating a booking does not add a second ledger pair", () => {
  let store = storeWithLabe();
  const opened = openXlDeparture(store, {
    id: "dep-1",
    axisId: "axis-labe",
    driverId: "driver-1",
    capacity: 4,
  });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  store = opened.store;
  const first = bookXlSeats(store, {
    bookingId: "book-1",
    idempotencyKey: "same",
    clientUserId: "client-1",
    departureId: "dep-1",
    detectedCountryCodes: ["GN", "GN"],
    originLabel: "Conakry",
    destinationLabel: "Labé",
    seatIndexes: [1],
    baggage: [{ weightKg: 5 }],
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  const again = bookXlSeats(first.store, {
    bookingId: "book-1b",
    idempotencyKey: "same",
    clientUserId: "client-1",
    departureId: "dep-1",
    detectedCountryCodes: ["GN", "GN"],
    originLabel: "Conakry",
    destinationLabel: "Labé",
    seatIndexes: [1],
    baggage: [],
  });
  assert.equal(again.ok, true);
  if (again.ok) {
    assert.equal(again.idempotent, true);
    assert.equal(again.store.ledger.length, 2);
    assert.equal(again.booking.quote.baggageGnf, 0);
  }
  const done = completeXlDeparture(first.store, { departureId: "dep-1", actorUserId: "driver-1" });
  assert.equal(done.ok, true);
  if (!done.ok) return;
  const cash = collectXlCash(done.store, { bookingId: "book-1", actorUserId: "driver-1" });
  assert.equal(cash.ok, true);
  if (!cash.ok) return;
  const repeat = collectXlCash(cash.store, { bookingId: "book-1", actorUserId: "driver-1" });
  assert.equal(repeat.ok, true);
  if (repeat.ok) {
    assert.equal(repeat.idempotent, true);
    assert.equal(repeat.store.ledger.length, 2);
  }
  const client = collectXlCash(done.store, { bookingId: "book-1", actorUserId: "client-1" });
  assert.equal(client.ok, false);
});

test("XL copy exists in all six languages", () => {
  const locales = ["en", "fr", "es", "ar", "zh", "ff"];
  const sets = locales.map((locale) => {
    const json = JSON.parse(
      fs.readFileSync(path.join(root, `apps/mobile/src/i18n/locales/${locale}/extras.json`), "utf8"),
    ) as { taxiXl?: Record<string, string> };
    return Object.keys(json.taxiXl ?? {}).sort();
  });
  const expected = sets[0] ?? [];
  assert.ok(expected.length >= 20);
  for (const keys of sets) assert.deepEqual(keys, expected);
});

test("the XL migration locks seats and does not touch standard taxi or wallet_ledger", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/migrations/20261218120000_guinea_xl_interregional.sql"),
    "utf8",
  );
  assert.match(sql, /for update/);
  assert.match(sql, /unique \(departure_id, seat_index\)/);
  assert.match(sql, /xl_seat_taken/);
  assert.equal(/drop table/i.test(sql), false);
  assert.equal(/truncate/i.test(sql), false);
  assert.equal(/alter table public\.taxi_rides/i.test(sql), false);
  assert.equal(/alter table public\.wallet_ledger/i.test(sql), false);
  assert.equal(/insert into public\.wallet_ledger/i.test(sql), false);
  const admin = fs.readFileSync(
    path.join(root, "apps/web/app/api/admin/guinea-xl/route.ts"),
    "utf8",
  );
  assert.match(admin, /taxi_pricing\.read/);
  assert.match(admin, /assertCanWriteTaxiPricing/);
  const http = fs.readFileSync(
    path.join(root, "apps/web/src/lib/markets/guineaXlHttp.ts"),
    "utf8",
  );
  assert.equal(/PaymentIntent|stripe/i.test(http), false);
  assert.match(http, /xl_eligible/);
  assert.match(http, /booking_id: item\.booking_id \? "taken" : null/);
  assert.match(http, /listClientGuineaXlBookings/);
});

test("N'zérékoré and Nzerekore share one locality key", () => {
  assert.equal(localityKey("N'zérékoré"), localityKey("Nzerekore"));
  assert.equal(localityKey("Labé"), localityKey("Labe"));
});

console.log("guineaXlPricing.test.ts passed");
