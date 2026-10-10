import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hasPermission } from "@/lib/adminRbac";
import { localityKey } from "@/lib/markets/guineaXlPricing";
import { XL_SEGMENT_LOCAL_ESTIMATES } from "@/lib/markets/guineaXlSegmentCatalog";
import { GUINEA_STANDARD_MAX_DISTANCE_METERS } from "@/lib/markets/guineaStandard";
import { persistGuineaXlSegmentBooking, quoteGuineaXlSegment } from "@/lib/markets/guineaXlHttp";
import {
  buildXlSegmentAdminView,
  buildXlSegmentPriceSnapshot,
  findXlSegmentPath,
  planXlSegmentCommercialBooking,
  planXlSegmentSeatHold,
  priceXlSegment,
  quoteXlPassengerFare,
  quoteXlSegmentRoute,
  requestXlSegmentCommercialBooking,
  validateXlSegmentGraph,
  XL_SEGMENT_COMMERCIAL_BOOKING_ENABLED,
  guineaXlSegmentMarketAllowed,
  guineaXlSegmentMarketAllowedWithDetection,
  segmentCanBeActivated,
  segmentCodesOverlap,
  type XlSegmentHoldStore,
  type XlSegmentInput,
  type XlSegmentTariff,
} from "@/lib/markets/guineaXlSegments";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

const TARIFF: XlSegmentTariff = {
  version: 1,
  baseGnf: 1_000,
  perKmGnf: 500,
  perMinuteGnf: 100,
  minimumGnf: 30_000,
};

function edge(
  code: string,
  originLabel: string,
  destinationLabel: string,
  distanceKm: number | null,
  durationMinutes: number | null,
  sequence: number,
  branch: XlSegmentInput["branch"],
  active = false,
  confirmed = false,
): XlSegmentInput {
  return {
    code,
    originLabel,
    destinationLabel,
    distanceKm,
    durationMinutes,
    active,
    confirmed,
    sequence,
    branch,
  };
}

function provisionalNetwork(active = false, confirmed = false): XlSegmentInput[] {
  return [
    edge("1", "Conakry", "Kindia", 128, 102, 1, "trunk", active, confirmed),
    edge("2", "Kindia", "Mamou", 134, 109, 2, "trunk", active, confirmed),
    edge("3", "Mamou", "Dalaba", 54, 75, 3, "trunk", active, confirmed),
    edge("4", "Dalaba", "Pita", 54, 42, 4, "trunk", active, confirmed),
    edge("5", "Pita", "Labé", 40, 32, 5, "trunk", active, confirmed),
    edge("6", "Labé", "Yembering", null, null, 6, "trunk", false, false),
    edge("7", "Yembering", "Dougountounny", null, null, 7, "dougountounny", false, false),
    edge("8", "Yembering", "Mali Centre", null, null, 8, "mali", false, false),
  ];
}

function openedNetwork(): XlSegmentInput[] {
  return provisionalNetwork(true, true).map((segment) =>
    segment.code === "6" || segment.code === "7" || segment.code === "8"
      ? { ...segment, active: false, confirmed: false, distanceKm: null, durationMinutes: null }
      : segment,
  );
}

function quoteTotal(origin: string, destination: string, segments = openedNetwork()) {
  const quote = quoteXlSegmentRoute({
    segments,
    originLabel: origin,
    destinationLabel: destination,
    tariff: TARIFF,
    mode: "definitive",
  });
  if (quote.ok === false) throw new Error(`${origin} ${destination}`);
  return quote;
}

const pending: Array<Promise<void>> = [];

function test(name: string, fn: () => void | Promise<void>) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      pending.push(
        result.then(
          () => console.log(`ok ${name}`),
          (error: unknown) => {
            console.error(`FAIL ${name}`);
            throw error;
          },
        ),
      );
      return;
    }
    console.log(`ok ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("segment prices use integers and the 30000 GNF minimum on each segment only", () => {
  const kindia = priceXlSegment({ distanceKm: 128, durationMinutes: 102, tariff: TARIFF });
  const mamou = priceXlSegment({ distanceKm: 134, durationMinutes: 109, tariff: TARIFF });
  const dalaba = priceXlSegment({ distanceKm: 54, durationMinutes: 75, tariff: TARIFF });
  const pita = priceXlSegment({ distanceKm: 54, durationMinutes: 42, tariff: TARIFF });
  const labe = priceXlSegment({ distanceKm: 40, durationMinutes: 32, tariff: TARIFF });
  assert.equal(kindia.ok && kindia.rawGnf, 75_200);
  assert.equal(kindia.ok && kindia.finalGnf, 75_200);
  assert.equal(mamou.ok && mamou.finalGnf, 78_900);
  assert.equal(dalaba.ok && dalaba.finalGnf, 35_500);
  assert.equal(pita.ok && pita.finalGnf, 32_200);
  assert.equal(labe.ok && labe.rawGnf, 24_200);
  assert.equal(labe.ok && labe.finalGnf, 30_000);
  assert.equal(labe.ok && labe.minimumApplied, true);
  assert.equal(priceXlSegment({ distanceKm: 128.5, durationMinutes: 102, tariff: TARIFF }).ok, false);
  assert.equal(priceXlSegment({ distanceKm: null, durationMinutes: 10, tariff: TARIFF }).ok, false);
  assert.equal(priceXlSegment({ distanceKm: 10, durationMinutes: null, tariff: TARIFF }).ok, false);
  assert.equal(priceXlSegment({ distanceKm: -1, durationMinutes: 10, tariff: TARIFF }).ok, false);
  const overflow = priceXlSegment({
    distanceKm: Number.MAX_SAFE_INTEGER,
    durationMinutes: 1,
    tariff: TARIFF,
  });
  assert.equal(overflow.ok, false);
});

test("route totals add segment finals and do not apply the minimum again", () => {
  assert.equal(quoteTotal("Conakry", "Kindia").totalGnf, 75_200);
  assert.equal(quoteTotal("Kindia", "Mamou").totalGnf, 78_900);
  assert.equal(quoteTotal("Conakry", "Mamou").totalGnf, 154_100);
  assert.equal(quoteTotal("Mamou", "Dalaba").totalGnf, 35_500);
  assert.equal(quoteTotal("Dalaba", "Pita").totalGnf, 32_200);
  assert.equal(quoteTotal("Pita", "Labé").totalGnf, 30_000);
  assert.equal(quoteTotal("Mamou", "Labé").totalGnf, 97_700);
  assert.equal(quoteTotal("Conakry", "Pita").totalGnf, 221_800);
  const labe = quoteTotal("Conakry", "Labé");
  assert.equal(labe.totalGnf, 251_800);
  assert.equal(labe.rawTotalGnf, 246_000);
  assert.deepEqual(labe.segments.map((segment) => segment.code), ["1", "2", "3", "4", "5"]);
  const claimed = quoteXlSegmentRoute({
    segments: openedNetwork(),
    originLabel: "Conakry",
    destinationLabel: "Labé",
    tariff: TARIFF,
    mode: "definitive",
    claimedTotalGnf: 1,
  });
  assert.equal(claimed.ok, false);
});

test("branches stay separate and unknown segments have no definitive price", () => {
  const network = openedNetwork();
  const dougoun = findXlSegmentPath(network, "Conakry", "Dougountounny");
  const mali = findXlSegmentPath(network, "Conakry", "Mali Centre");
  assert.equal(dougoun.ok, true);
  assert.equal(mali.ok, true);
  if (dougoun.ok && mali.ok) {
    assert.deepEqual(dougoun.segments.map((segment) => segment.code), ["1", "2", "3", "4", "5", "6", "7"]);
    assert.deepEqual(mali.segments.map((segment) => segment.code), ["1", "2", "3", "4", "5", "6", "8"]);
    assert.equal(dougoun.segments.some((segment) => segment.code === "8"), false);
    assert.equal(mali.segments.some((segment) => segment.code === "7"), false);
  }
  assert.equal(findXlSegmentPath(network, "Dougountounny", "Mali Centre").ok, false);
  assert.equal(findXlSegmentPath(network, "Kindia", "Conakry").ok, false);
  assert.equal(findXlSegmentPath(network, "Labé", "Labé").ok, false);
  for (const [origin, destination] of [
    ["Conakry", "Yembering"],
    ["Conakry", "Dougountounny"],
    ["Conakry", "Mali Centre"],
    ["Labé", "Yembering"],
  ] as const) {
    const quote = quoteXlSegmentRoute({
      segments: network,
      originLabel: origin,
      destinationLabel: destination,
      tariff: TARIFF,
      mode: "preview",
    });
    assert.equal(quote.ok, false);
    if (quote.ok === false) assert.equal(quote.error, "xl_segment_not_priced");
  }
});

test("the eight local estimates calculate without becoming a confirmed fare", () => {
  assert.equal(XL_SEGMENT_LOCAL_ESTIMATES.length, 8);
  assert.equal(XL_SEGMENT_LOCAL_ESTIMATES.every((segment) => segment.active && segment.confirmed === false), true);
  assert.equal(XL_SEGMENT_COMMERCIAL_BOOKING_ENABLED, false);
  const yembering = priceXlSegment({ distanceKm: 70, durationMinutes: 120, tariff: TARIFF });
  const dougoun = priceXlSegment({ distanceKm: 40, durationMinutes: 61, tariff: TARIFF });
  const maliSegment = priceXlSegment({ distanceKm: 40, durationMinutes: 180, tariff: TARIFF });
  assert.equal(yembering.ok && yembering.rawGnf, 48_000);
  assert.equal(yembering.ok && yembering.finalGnf, 48_000);
  assert.equal(dougoun.ok && dougoun.rawGnf, 27_100);
  assert.equal(dougoun.ok && dougoun.finalGnf, 30_000);
  assert.equal(dougoun.ok && dougoun.minimumApplied, true);
  assert.equal(maliSegment.ok && maliSegment.finalGnf, 39_000);
  const local = (origin: string, destination: string) => {
    const quote = quoteXlSegmentRoute({
      segments: XL_SEGMENT_LOCAL_ESTIMATES,
      originLabel: origin,
      destinationLabel: destination,
      tariff: TARIFF,
      mode: "local",
    });
    if (quote.ok === false) throw new Error(`${origin} ${destination} ${quote.error}`);
    return quote;
  };
  assert.equal(local("Conakry", "Kindia").totalGnf, 75_200);
  assert.equal(local("Conakry", "Mamou").totalGnf, 154_100);
  assert.equal(local("Conakry", "Pita").totalGnf, 221_800);
  assert.equal(local("Conakry", "Labé").totalGnf, 251_800);
  assert.equal(local("Mamou", "Labé").totalGnf, 97_700);
  assert.equal(local("Conakry", "Yembering").totalGnf, 299_800);
  const toDougoun = local("Conakry", "Dougountounny");
  const toMali = local("Conakry", "Mali Centre");
  assert.equal(toDougoun.totalGnf, 329_800);
  assert.equal(toMali.totalGnf, 338_800);
  assert.equal(toDougoun.definitive, false);
  assert.equal(toMali.definitive, false);
  assert.deepEqual(toDougoun.segments.map((segment) => segment.code), ["1", "2", "3", "4", "5", "6", "7"]);
  assert.deepEqual(toMali.segments.map((segment) => segment.code), ["1", "2", "3", "4", "5", "6", "8"]);
  assert.equal(local("Labé", "Dougountounny").totalGnf, 78_000);
  assert.equal(local("Labé", "Mali Centre").totalGnf, 87_000);
  assert.equal(local("Yembering", "Dougountounny").totalGnf, 30_000);
  assert.equal(local("Yembering", "Mali Centre").totalGnf, 39_000);
  const blocked = quoteXlSegmentRoute({
    segments: XL_SEGMENT_LOCAL_ESTIMATES,
    originLabel: "Conakry",
    destinationLabel: "Dougountounny",
    tariff: TARIFF,
    mode: "definitive",
  });
  assert.equal(blocked.ok, false);
  if (blocked.ok === false) assert.equal(blocked.error, "xl_segment_unconfirmed");
  const stopped = XL_SEGMENT_LOCAL_ESTIMATES.map((segment) =>
    segment.code === "6" ? { ...segment, active: false } : segment,
  );
  const inactive = quoteXlSegmentRoute({
    segments: stopped,
    originLabel: "Conakry",
    destinationLabel: "Yembering",
    tariff: TARIFF,
    mode: "local",
  });
  assert.equal(inactive.ok, false);
  if (inactive.ok === false) assert.equal(inactive.error, "xl_segment_inactive");
  const missing = XL_SEGMENT_LOCAL_ESTIMATES.map((segment) =>
    segment.code === "8" ? { ...segment, distanceKm: null, durationMinutes: null } : segment,
  );
  const unpriced = quoteXlSegmentRoute({
    segments: missing,
    originLabel: "Yembering",
    destinationLabel: "Mali Centre",
    tariff: TARIFF,
    mode: "local",
  });
  assert.equal(unpriced.ok, false);
  if (unpriced.ok === false) assert.equal(unpriced.error, "xl_segment_not_priced");
  const front = quoteXlPassengerFare({
    segments: XL_SEGMENT_LOCAL_ESTIMATES,
    originLabel: "Conakry",
    destinationLabel: "Mali Centre",
    tariff: TARIFF,
    seatIndex: 1,
    mode: "local",
  });
  const rear = quoteXlPassengerFare({
    segments: XL_SEGMENT_LOCAL_ESTIMATES,
    originLabel: "Conakry",
    destinationLabel: "Mali Centre",
    tariff: TARIFF,
    seatIndex: 4,
    mode: "local",
  });
  if (front.ok === false || rear.ok === false) throw new Error("local fare");
  assert.equal(front.fare.transportGnf, 338_800);
  assert.equal(rear.fare.transportGnf, 338_800);
  assert.equal(front.fare.seatSupplementGnf, 0);
  assert.equal(rear.fare.seatRole, "other");
  assert.equal(front.fare.definitive, false);
  const saved = buildXlSegmentPriceSnapshot({
    fare: front.fare,
    tariff: TARIFF,
    platformShareBps: 1_000,
    baggageGnf: 30_000,
  });
  if (saved.ok === false) throw new Error("local snapshot");
  assert.equal(saved.snapshot.platformFeeGnf, 33_880);
  assert.equal(saved.snapshot.driverAmountGnf, 304_920);
  assert.equal(saved.snapshot.platformFeeGnf + saved.snapshot.driverAmountGnf, saved.snapshot.transportGnf);
  assert.equal(saved.snapshot.totalGnf, 368_800);
  assert.equal(saved.snapshot.commercialBooking, false);
  const commercial = planXlSegmentCommercialBooking({
    idempotencyKey: "local-estimate",
    segments: XL_SEGMENT_LOCAL_ESTIMATES,
    originLabel: "Conakry",
    destinationLabel: "Labé",
    tariff: TARIFF,
    seatIndex: 1,
    platformShareBps: 1_000,
    baggageGnf: 0,
  });
  assert.equal(commercial.ok, false);
  if (commercial.ok === false) assert.equal(commercial.error, "xl_segment_unconfirmed");
  const view = buildXlSegmentAdminView(XL_SEGMENT_LOCAL_ESTIMATES, TARIFF);
  assert.equal(view.segments.length, 8);
  assert.equal(view.segments.every((segment) => segment.priceable && segment.confirmed === false), true);
  const shown = view.routes.find((route) => route.destinationLabel === "Dougountounny" && route.originLabel === "Conakry");
  assert.equal(shown?.totalGnf, 329_800);
  assert.equal(shown?.definitive, false);
});

test("inactive or unconfirmed segments are not a definitive fare", () => {
  const inactive = quoteXlSegmentRoute({
    segments: provisionalNetwork(false, true),
    originLabel: "Conakry",
    destinationLabel: "Kindia",
    tariff: TARIFF,
    mode: "definitive",
  });
  assert.equal(inactive.ok, false);
  if (inactive.ok === false) assert.equal(inactive.error, "xl_segment_inactive");
  const unconfirmed = quoteXlSegmentRoute({
    segments: provisionalNetwork(true, false),
    originLabel: "Conakry",
    destinationLabel: "Kindia",
    tariff: TARIFF,
    mode: "definitive",
  });
  assert.equal(unconfirmed.ok, false);
  if (unconfirmed.ok === false) assert.equal(unconfirmed.error, "xl_segment_unconfirmed");
  const preview = quoteXlSegmentRoute({
    segments: provisionalNetwork(false, false),
    originLabel: "Pita",
    destinationLabel: "Labé",
    tariff: TARIFF,
    mode: "preview",
  });
  assert.equal(preview.ok, true);
  if (preview.ok) {
    assert.equal(preview.definitive, false);
    assert.equal(preview.totalGnf, 30_000);
  }
  assert.equal(segmentCanBeActivated(null, null), false);
  assert.equal(segmentCanBeActivated(40, 32), true);
});

test("a confirmed snapshot keeps the route total and the 10 percent transport commission", () => {
  const priced = quoteXlPassengerFare({
    segments: openedNetwork(),
    originLabel: "Conakry",
    destinationLabel: "Kindia",
    tariff: TARIFF,
    seatIndex: 1,
  });
  if (priced.ok === false) throw new Error("passenger");
  const saved = buildXlSegmentPriceSnapshot({
    fare: priced.fare,
    tariff: TARIFF,
    platformShareBps: 1_000,
    baggageGnf: 30_000,
  });
  if (saved.ok === false) throw new Error("snapshot");
  assert.equal(saved.snapshot.commercialBooking, false);
  assert.equal(saved.snapshot.seatPricing, "per_passenger");
  assert.equal(saved.snapshot.seatRole, "front");
  assert.equal(saved.snapshot.seatSupplementGnf, 0);
  assert.equal(saved.snapshot.transportGnf, 75_200);
  assert.equal(saved.snapshot.baggageGnf, 30_000);
  assert.equal(saved.snapshot.totalGnf, 105_200);
  assert.equal(saved.snapshot.platformFeeGnf, 7_520);
  assert.equal(saved.snapshot.driverAmountGnf, 67_680);
  assert.equal(saved.snapshot.platformFeeGnf + saved.snapshot.driverAmountGnf, saved.snapshot.transportGnf);
  const later = { ...TARIFF, perKmGnf: 9_999 };
  assert.equal(saved.snapshot.perKmGnf, 500);
  assert.notEqual(saved.snapshot.perKmGnf, later.perKmGnf);
  const standardBps = buildXlSegmentPriceSnapshot({
    fare: priced.fare,
    tariff: TARIFF,
    platformShareBps: 1_500,
    baggageGnf: 0,
  });
  assert.equal(standardBps.ok, true);
  if (standardBps.ok) assert.notEqual(standardBps.snapshot.platformShareBps, saved.snapshot.platformShareBps);
});

test("each passenger pays the full route price and seat role adds nothing", () => {
  const segments = openedNetwork();
  const front = quoteXlPassengerFare({
    segments,
    originLabel: "Conakry",
    destinationLabel: "Labé",
    tariff: TARIFF,
    seatIndex: 1,
  });
  const rear = quoteXlPassengerFare({
    segments,
    originLabel: "Conakry",
    destinationLabel: "Labé",
    tariff: TARIFF,
    seatIndex: 4,
  });
  const kindia = quoteXlPassengerFare({
    segments,
    originLabel: "Kindia",
    destinationLabel: "Mamou",
    tariff: TARIFF,
    seatIndex: 2,
  });
  const mamou = quoteXlPassengerFare({
    segments,
    originLabel: "Mamou",
    destinationLabel: "Labé",
    tariff: TARIFF,
    seatIndex: 3,
  });
  if (front.ok === false || rear.ok === false || kindia.ok === false || mamou.ok === false) {
    throw new Error("passenger fare");
  }
  assert.equal(front.fare.transportGnf, 251_800);
  assert.equal(rear.fare.transportGnf, 251_800);
  assert.equal(front.fare.seatRole, "front");
  assert.equal(rear.fare.seatRole, "other");
  assert.equal(front.fare.seatSupplementGnf, 0);
  assert.equal(rear.fare.seatSupplementGnf, 0);
  assert.notEqual(front.fare.transportGnf, Math.floor(251_800 / 4));
  assert.notEqual(front.fare.transportGnf, 251_800 * 4);
  assert.equal(kindia.fare.transportGnf, 78_900);
  assert.deepEqual(kindia.fare.segments.map((segment) => segment.code), ["2"]);
  assert.equal(mamou.fare.transportGnf, 97_700);
  assert.deepEqual(mamou.fare.segments.map((segment) => segment.code), ["3", "4", "5"]);
  assert.equal(quoteXlPassengerFare({
    segments,
    originLabel: "Conakry",
    destinationLabel: "Labé",
    tariff: TARIFF,
    seatIndex: 1,
    passengerCount: 4,
  }).ok, false);
  assert.equal(quoteXlPassengerFare({
    segments,
    originLabel: "Conakry",
    destinationLabel: "Labé",
    tariff: TARIFF,
    seatIndex: 1,
    seatCount: 2,
  }).ok, false);
  const first = buildXlSegmentPriceSnapshot({
    fare: front.fare,
    tariff: TARIFF,
    platformShareBps: 1_000,
    baggageGnf: 0,
  });
  const second = buildXlSegmentPriceSnapshot({
    fare: rear.fare,
    tariff: TARIFF,
    platformShareBps: 1_000,
    baggageGnf: 0,
  });
  if (first.ok === false || second.ok === false) throw new Error("snapshot");
  assert.equal(first.snapshot.transportGnf, 251_800);
  assert.equal(second.snapshot.transportGnf, 251_800);
  assert.equal(first.snapshot.platformFeeGnf, 25_180);
  assert.equal(first.snapshot.driverAmountGnf, 226_620);
  assert.equal(first.snapshot.platformFeeGnf + first.snapshot.driverAmountGnf, first.snapshot.transportGnf);
  assert.equal(first.snapshot.commercialBooking, false);
  assert.equal(second.snapshot.commercialBooking, false);
});

test("a segment commercial request stays disabled and does not multiply the fare", () => {
  assert.equal(XL_SEGMENT_COMMERCIAL_BOOKING_ENABLED, false);
  const refused = requestXlSegmentCommercialBooking();
  assert.equal(refused.ok, false);
  if (refused.ok === false) assert.equal(refused.error, "xl_segment_commercial_disabled");
  const segments = openedNetwork();
  const one = planXlSegmentCommercialBooking({
    idempotencyKey: "passenger-1",
    segments,
    originLabel: "Conakry",
    destinationLabel: "Labé",
    tariff: TARIFF,
    seatIndex: 2,
    platformShareBps: 1_000,
    baggageGnf: 30_000,
  });
  const two = planXlSegmentCommercialBooking({
    idempotencyKey: "passenger-2",
    segments,
    originLabel: "Conakry",
    destinationLabel: "Labé",
    tariff: TARIFF,
    seatIndex: 3,
    platformShareBps: 1_000,
    baggageGnf: 0,
  });
  if (one.ok === false || two.ok === false) throw new Error("plan");
  assert.equal(one.plan.commercialBooking, false);
  assert.equal(two.plan.commercialBooking, false);
  assert.equal(one.plan.snapshot.transportGnf, 251_800);
  assert.equal(two.plan.snapshot.transportGnf, 251_800);
  assert.equal(one.plan.snapshot.platformFeeGnf, 25_180);
  assert.equal(one.plan.snapshot.baggageGnf, 30_000);
  assert.equal(one.plan.snapshot.platformFeeGnf + one.plan.snapshot.driverAmountGnf, one.plan.snapshot.transportGnf);
  assert.equal(one.plan.fare.seatRole, "other");
  assert.equal(planXlSegmentCommercialBooking({
    idempotencyKey: "",
    segments,
    originLabel: "Conakry",
    destinationLabel: "Labé",
    tariff: TARIFF,
    seatIndex: 1,
    platformShareBps: 1_000,
    baggageGnf: 0,
  }).ok, false);
});

test("a Guinea segment booking stays inside Guinea and does not open another market", async () => {
  for (const countryCode of ["US", "CA", "BE"]) {
    assert.equal(guineaXlSegmentMarketAllowed({ countryCode, currency: "GNF" }), false);
  }
  for (const currency of ["USD", "CAD", "EUR"]) {
    assert.equal(guineaXlSegmentMarketAllowed({ countryCode: "GN", currency }), false);
  }
  assert.equal(guineaXlSegmentMarketAllowed({ countryCode: "GN", currency: "GNF" }), true);
  assert.equal(guineaXlSegmentMarketAllowedWithDetection({ countryCode: "GN", currency: "GNF" }, "US"), false);
  assert.equal(guineaXlSegmentMarketAllowedWithDetection({ countryCode: "GN", currency: "GNF" }, "CA"), false);
  assert.equal(guineaXlSegmentMarketAllowedWithDetection({ countryCode: "GN", currency: "GNF" }, "BE"), false);
  assert.equal(guineaXlSegmentMarketAllowedWithDetection({ countryCode: "GN", currency: "GNF" }, "GN"), true);
  assert.equal(guineaXlSegmentMarketAllowedWithDetection({ currency: "GNF" }, null), true);
  const untouched = {
    from() {
      throw new Error("another market reached the database");
    },
    rpc() {
      throw new Error("another market reached the database");
    },
  };
  for (const countryCode of ["US", "CA", "BE"]) {
    const quoted = await quoteGuineaXlSegment(untouched as never, {
      countryCode,
      currency: "USD",
      originLabel: "Conakry",
      destinationLabel: "Kindia",
    });
    const quoteBody = (await quoted.json()) as { error?: string };
    assert.equal(quoteBody.error, "xl_market_unavailable");
    const booked = await persistGuineaXlSegmentBooking(untouched as never, "client", {
      bookingKind: "segment",
      countryCode,
      currency: "USD",
      originLabel: "Conakry",
      destinationLabel: "Kindia",
    });
    const bookBody = (await booked.json()) as { error?: string };
    assert.equal(bookBody.error, "xl_market_unavailable");
  }
  const guinea = await persistGuineaXlSegmentBooking(untouched as never, "client", {
    bookingKind: "segment",
    countryCode: "GN",
    currency: "GNF",
    originLabel: "Conakry",
    destinationLabel: "Kindia",
  });
  const guineaBody = (await guinea.json()) as { error?: string };
  assert.equal(guineaBody.error, "xl_segment_commercial_disabled");
  const httpSource = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "guineaXlHttp.ts"), "utf8");
  const quoteAt = httpSource.indexOf("export async function quoteGuineaXlSegment");
  const gateAt = httpSource.indexOf("segmentMarketClosed", quoteAt);
  const rpcAt = httpSource.indexOf("quote_guinea_xl_segments", quoteAt);
  assert.equal(gateAt > quoteAt && gateAt < rpcAt, true);
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  for (const relative of [
    "src/lib/markets/guineaStandard.ts",
    "src/lib/taxiCurrencyGuard.ts",
    "src/lib/taxiStripeAmounts.ts",
    "src/lib/platformCurrency.ts",
  ]) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    assert.equal(source.includes("XL_SEGMENT_COMMERCIAL_BOOKING_ENABLED"), false);
    assert.equal(source.includes("guinea_xl_segments"), false);
  }
});

test("seat holds block an overlap and allow the next free portion", () => {
  const segments = openedNetwork();
  let store: XlSegmentHoldStore = { holds: [] };
  const first = planXlSegmentSeatHold(store, {
    id: "hold-1",
    idempotencyKey: "client-a-1",
    clientUserId: "client-a",
    departureId: "run-1",
    seatIndex: 2,
    segments,
    originLabel: "Conakry",
    destinationLabel: "Mamou",
    tariff: TARIFF,
  });
  if (first.ok === false) throw new Error("hold");
  assert.equal(first.hold.commercialBooking, false);
  assert.equal(first.hold.transportGnf, 154_100);
  assert.deepEqual(first.hold.segmentCodes, ["1", "2"]);
  const repeat = planXlSegmentSeatHold(first.store, {
    ...{
      id: "hold-other",
      idempotencyKey: "client-a-1",
      clientUserId: "client-a",
      departureId: "run-1",
      seatIndex: 2,
      segments,
      originLabel: "Conakry",
      destinationLabel: "Labé",
      tariff: TARIFF,
    },
  });
  assert.equal(repeat.ok, true);
  if (repeat.ok) {
    assert.equal(repeat.idempotent, true);
    assert.equal(repeat.store.holds.length, 1);
    assert.equal(repeat.hold.transportGnf, 154_100);
  }
  const next = planXlSegmentSeatHold(first.store, {
    id: "hold-2",
    idempotencyKey: "client-b-1",
    clientUserId: "client-b",
    departureId: "run-1",
    seatIndex: 2,
    segments,
    originLabel: "Mamou",
    destinationLabel: "Labé",
    tariff: TARIFF,
  });
  assert.equal(next.ok, true);
  if (next.ok) assert.deepEqual(next.hold.segmentCodes, ["3", "4", "5"]);
  const overlap = planXlSegmentSeatHold(first.store, {
    id: "hold-3",
    idempotencyKey: "client-c-1",
    clientUserId: "client-c",
    departureId: "run-1",
    seatIndex: 2,
    segments,
    originLabel: "Kindia",
    destinationLabel: "Dalaba",
    tariff: TARIFF,
  });
  assert.equal(overlap.ok, false);
  if (overlap.ok === false) assert.equal(overlap.error, "xl_seat_taken");
  assert.equal(segmentCodesOverlap(["1", "2", "3", "4"], ["2", "3"]), true);
  assert.equal(segmentCodesOverlap(["1", "2"], ["3", "4", "5"]), false);
  const missing = planXlSegmentSeatHold(store, {
    id: "hold-4",
    idempotencyKey: "client-d-1",
    clientUserId: "client-d",
    departureId: "run-1",
    seatIndex: 2,
    segments,
    originLabel: "Conakry",
    destinationLabel: "Yembering",
    tariff: TARIFF,
  });
  assert.equal(missing.ok, false);
  store = first.store;
  assert.equal(store.holds.length, 1);
});

test("two simultaneous holds for one overlapping seat cannot both commit", () => {
  const segments = openedNetwork();
  const empty: XlSegmentHoldStore = { holds: [] };
  const left = planXlSegmentSeatHold(empty, {
    id: "race-a",
    idempotencyKey: "race-a",
    clientUserId: "a",
    departureId: "run-1",
    seatIndex: 1,
    segments,
    originLabel: "Conakry",
    destinationLabel: "Pita",
    tariff: TARIFF,
  });
  const right = planXlSegmentSeatHold(empty, {
    id: "race-b",
    idempotencyKey: "race-b",
    clientUserId: "b",
    departureId: "run-1",
    seatIndex: 1,
    segments,
    originLabel: "Mamou",
    destinationLabel: "Labé",
    tariff: TARIFF,
  });
  if (left.ok === false || right.ok === false) throw new Error("race");
  assert.equal(segmentCodesOverlap(left.hold.segmentCodes, right.hold.segmentCodes), true);
  const second = planXlSegmentSeatHold(left.store, {
    id: right.hold.id,
    idempotencyKey: right.hold.idempotencyKey,
    clientUserId: right.hold.clientUserId,
    departureId: right.hold.departureId,
    seatIndex: right.hold.seatIndex,
    segments,
    originLabel: "Mamou",
    destinationLabel: "Labé",
    tariff: TARIFF,
  });
  assert.equal(second.ok, false);
});

test("the segment graph stays one path and keeps the two branches exclusive", () => {
  assert.equal(validateXlSegmentGraph(XL_SEGMENT_LOCAL_ESTIMATES).ok, true);
  const doubled = XL_SEGMENT_LOCAL_ESTIMATES.map((segment) =>
    segment.code === "3" ? { ...segment, originLabel: "Conakry", destinationLabel: "Mamou" } : segment,
  );
  assert.equal(validateXlSegmentGraph(doubled).ok, false);
  const merged = XL_SEGMENT_LOCAL_ESTIMATES.map((segment) =>
    segment.code === "8" ? { ...segment, originLabel: "Dougountounny", destinationLabel: "Mali Centre" } : segment,
  );
  assert.equal(validateXlSegmentGraph(merged).ok, false);
  const cycle = XL_SEGMENT_LOCAL_ESTIMATES.map((segment) =>
    segment.code === "2" ? { ...segment, destinationLabel: "Conakry" } : segment,
  );
  assert.equal(validateXlSegmentGraph(cycle).ok, false);
});

test("admin permissions and server recalculation stay on the existing taxi pricing roles", () => {
  assert.equal(hasPermission("super_admin", "taxi_pricing.read"), true);
  assert.equal(hasPermission("super_admin", "taxi_pricing.write"), true);
  assert.equal(hasPermission("finance_admin", "taxi_pricing.read"), true);
  assert.equal(hasPermission("finance_admin", "taxi_pricing.write"), false);
  assert.equal(hasPermission("operations_admin", "taxi_pricing.read"), false);
  assert.equal(hasPermission("operations_admin", "taxi_pricing.write"), false);
  const route = fs.readFileSync(path.join(root, "apps/web/app/api/admin/guinea-xl/route.ts"), "utf8");
  assert.match(route, /assertStaffPermission\("taxi_pricing.read"/);
  assert.match(route, /assertCanWriteTaxiPricing/);
  assert.match(route, /save_segment_tariff/);
  assert.match(route, /segmentCanBeActivated/);
  assert.match(route, /validateXlSegmentGraph/);
  assert.match(route, /origin_key/);
  assert.match(route, /estimate_source/);
  assert.equal(route.includes("final_gnf:"), false);
  assert.equal(route.includes("XL_SEGMENT_LOCAL_ESTIMATES"), false);
  assert.equal(route.includes("guineaXlSegmentCatalog"), false);
  assert.equal(/guinea_xl_segment_tariff[\s\S]{0,500}platform_share_bps/.test(route), false);
  const view = buildXlSegmentAdminView(provisionalNetwork(), TARIFF);
  const labe = view.routes.find((item) => item.originLabel === "Conakry" && item.destinationLabel === "Labé");
  const yembering = view.routes.find((item) => item.originLabel === "Conakry" && item.destinationLabel === "Yembering");
  assert.equal(labe?.totalGnf, 251_800);
  assert.equal(labe?.definitive, false);
  assert.equal(yembering?.totalGnf, null);
  assert.equal(yembering?.error, "xl_segment_not_priced");
});

test("the pending segment migration does not change Standard, commission, or existing seat locks", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/pending/20261018120000_guinea_xl_segments.sql"),
    "utf8",
  );
  assert.match(sql, /do not apply/i);
  assert.match(sql, /minimum_gnf/);
  assert.match(sql, /30000/);
  assert.match(sql, /active = false/);
  assert.match(sql, /confirmed = false/);
  assert.match(sql, /70, 120, true, false/);
  assert.match(sql, /40, 61, true, false/);
  assert.match(sql, /40, 180, true, false/);
  assert.equal(/true, true/.test(sql), false);
  assert.equal(localityKey("Labé"), "labe");
  assert.equal(localityKey("Mali Centre"), "malicentre");
  assert.match(sql, /'malicentre'/);
  assert.match(sql, /guinea_xl_seat_axis_respects_segments/);
  assert.match(sql, /references public\.guinea_xl_departures/);
  assert.match(sql, /references public\.guinea_xl_seats \(departure_id, seat_index\)/);
  assert.match(sql, /references public\.guinea_xl_bookings/);
  assert.match(sql, /unique \(departure_id, seat_index, segment_id\)/);
  assert.match(sql, /unique \(booking_id, position\)/);
  assert.equal(/drop constraint[\s\S]{0,120}idempotency/i.test(sql), false);
  assert.equal(/create or replace function public\.create_guinea_xl_booking\s*\(/i.test(sql), false);
  assert.match(sql, /create or replace function public\.create_guinea_xl_segment_booking/);
  assert.match(sql, /quote_guinea_xl_segments/);
  const originalXl = fs.readFileSync(
    path.join(root, "supabase/migrations/20261218120000_guinea_xl_interregional.sql"),
    "utf8",
  );
  assert.match(originalXl, /unique \(client_user_id, idempotency_key\)/);
  assert.match(originalXl, /unique \(departure_id, seat_index\)/);
  assert.match(originalXl, /check \(platform_fee_gnf \+ driver_amount_gnf = transport_gnf\)/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.guinea_xl_segments from anon, authenticated/);
  assert.equal(/create policy/i.test(sql), false);
  assert.match(sql, /grant all on public\.guinea_xl_segments to service_role/);
  assert.match(sql, /xl_financial_snapshot_frozen/);
  assert.match(sql, /xl_segment_snapshot_frozen/);
  assert.match(sql, /reserve_guinea_xl_segment_seat/);
  assert.match(sql, /for update/);
  assert.match(sql, /xl_seat_taken/);
  assert.equal(/create or replace function public\.create_guinea_xl_booking\s*\(/i.test(sql), false);
  assert.match(sql, /create or replace function public\.create_guinea_xl_segment_booking/);
  assert.match(sql, /quote_guinea_xl_segments/);
  assert.equal(/alter table public\.guinea_xl_bookings[\s\S]{0,180}payment_status/i.test(sql), false);
  assert.equal(/update public\.guinea_xl_settings/i.test(sql), false);
  assert.equal(/insert into public\.guinea_xl_settings/i.test(sql), false);
  assert.equal(/guinea_standard_settings/i.test(sql), false);
  assert.equal(/wallet_ledger/i.test(sql), false);
  assert.equal(/taxi_rides/i.test(sql), false);
  assert.equal(/set platform_share_bps/i.test(sql), false);
  assert.equal(/drop table public\.guinea_xl_seats/i.test(sql), false);
  assert.match(sql, /unique \(departure_id, seat_index, segment_id\)/);
  assert.equal(GUINEA_STANDARD_MAX_DISTANCE_METERS, 100_000);
  const pricing = fs.readFileSync(path.join(root, "apps/web/src/lib/markets/guineaXlSegments.ts"), "utf8");
  for (const token of ["75200", "75_200", "30000", "30_000", "128"]) {
    assert.equal(pricing.includes(token), false, token);
  }
  const http = fs.readFileSync(path.join(root, "apps/web/src/lib/markets/guineaXlHttp.ts"), "utf8");
  assert.match(http, /create_guinea_xl_booking/);
  assert.match(http, /create_guinea_xl_segment_booking/);
  assert.match(http, /quote_guinea_xl_segments/);
  assert.match(http, /xl_segment_commercial_disabled/);
  assert.match(http, /bookingKind === "segment"/);
  assert.match(http, /segmentCommercialBookingEnabled\(\)/);
  assert.equal(http.includes("guinea_xl_seat_segments"), false);
  assert.equal(http.includes("reserve_guinea_xl_segment_seat"), false);
  assert.equal(http.includes("quoteXlSegmentRoute"), false);
  assert.equal(http.includes("planXlSegmentSeatHold"), false);
  assert.equal(http.includes("quoteXlPassengerFare"), false);
  assert.equal(http.includes("guineaXlSegmentCatalog"), false);
  assert.equal(http.includes("XL_SEGMENT_LOCAL_ESTIMATES"), false);
  const standardPricing = fs.readFileSync(path.join(root, "apps/web/src/lib/markets/guineaTaxiPricing.ts"), "utf8");
  assert.equal(standardPricing.includes("guinea_xl_segment"), false);
});

Promise.all(pending)
  .then(() => console.log("guineaXlSegments.test.ts passed"))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
