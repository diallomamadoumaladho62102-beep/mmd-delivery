import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatRevenueToday,
  revenueTodayByCurrency,
  revenueTodayCents,
  type AdminTaxiRideListItem,
} from "@/lib/adminTaxiRideDisplay";
import { formatRideMoney } from "@/lib/adminTaxiRideDisplay";
import {
  buildCashCollectionLedgerRow,
  evaluateCashCollection,
  taxiCashSkipsStripe,
  taxiPaymentAllowsDispatch,
  type CashRideSnapshot,
} from "@/lib/markets/guineaCashPayment";
import {
  coordinatesInGuineaNationalExtent,
  guineaCountryEvidenceAllowsMarket,
  isGuineaMarketEnabled,
  localityLabel,
  resolveGuineaTaxiMarket,
} from "@/lib/markets/guineaMarket";
import {
  isOrangeMoneyGuineaEnabled,
  ORANGE_MONEY_STATUSES,
  orangeMoneyGuineaConfig,
} from "@/lib/markets/guineaOrangeMoney";
import {
  calculateGuineaTaxiFareGnf,
  formatGuineaFare,
  readGuineaTaxiRateCard,
  type GuineaTaxiRateCard,
} from "@/lib/markets/guineaTaxiPricing";
import { orangeMoneyGuineaAdapter } from "@/lib/paymentProviders";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");

const CONAKRY = { lat: 9.6411, lng: -13.5784 };
const KALOUM = { lat: 9.5092, lng: -13.7122 };
const NYC = { lat: 40.758, lng: -73.9855 };
/** Examples used to prove the market is not a city list. They are not an allow-list. */
const NATIONAL_EXAMPLES = {
  conakry: { lat: 9.6412, lng: -13.5784 },
  kindia: { lat: 10.057, lng: -12.865 },
  boke: { lat: 10.932, lng: -14.291 },
  mamou: { lat: 10.376, lng: -12.091 },
  labe: { lat: 11.318, lng: -12.283 },
  kankan: { lat: 10.385, lng: -9.306 },
  faranah: { lat: 10.04, lng: -10.743 },
  nzerekore: { lat: 7.756, lng: -8.818 },
  siguiri: { lat: 11.422, lng: -9.168 },
  kissidougou: { lat: 9.185, lng: -10.1 },
  dalaba: { lat: 10.692, lng: -12.249 },
};
/** Inside the performance rectangle, confirmed by Mapbox as another country. */
const RECTANGLE_NEIGHBORS = {
  freetown: { lat: 8.484, lng: -13.234, country: "SL" },
  bamako: { lat: 12.639, lng: -8.003, country: "ML" },
};

const TEST_CARD: GuineaTaxiRateCard = {
  baseFareGnf: 5_000,
  perKmGnf: 2_000,
  perMinuteGnf: 500,
  minimumFareGnf: 10_000,
  maximumFareGnf: 500_000,
};

function cashRide(partial: Partial<CashRideSnapshot> = {}): CashRideSnapshot {
  return {
    id: "ride-1",
    clientUserId: "client-1",
    driverId: "driver-1",
    status: "completed",
    paymentMethod: "cash",
    paymentStatus: "pending_cash",
    currency: "GNF",
    countryCode: "GN",
    totalCents: 85_000,
    ...partial,
  };
}

function test(name: string, fn: () => void | Promise<void>) {
  const result = fn();
  if (result && typeof (result as Promise<void>).then === "function") {
    return (result as Promise<void>).then(
      () => console.log(`ok ${name}`),
      (error) => {
        console.error(`FAIL ${name}`);
        throw error;
      },
    );
  }
  console.log(`ok ${name}`);
}

const pending: Array<Promise<void>> = [];

pending.push(test("US coordinates stay on the US market", () => {
  const decision = resolveGuineaTaxiMarket({
    enabled: true,
    claimedCountryCode: "US",
    pickupLat: NYC.lat,
    pickupLng: NYC.lng,
    dropoffLat: 40.75,
    dropoffLng: -73.99,
    vehicleClass: "standard",
  });
  assert.equal(decision.kind, "us");
}));

pending.push(test("a client cannot force Guinea pricing onto a US trip", () => {
  const decision = resolveGuineaTaxiMarket({
    enabled: true,
    claimedCountryCode: "GN",
    pickupLat: NYC.lat,
    pickupLng: NYC.lng,
    dropoffLat: 40.75,
    dropoffLng: -73.99,
    vehicleClass: "standard",
  });
  assert.equal(decision.kind, "reject");
  if (decision.kind === "reject") assert.equal(decision.error, "market_mismatch");
}));

pending.push(test("the national market is enabled unless explicitly turned off", () => {
  assert.equal(isGuineaMarketEnabled({}), true);
  assert.equal(isGuineaMarketEnabled({ GUINEA_MARKET_ENABLED: "false" }), false);
  const decision = resolveGuineaTaxiMarket({
    enabled: false,
    claimedCountryCode: "GN",
    pickupLat: NATIONAL_EXAMPLES.kindia.lat,
    pickupLng: NATIONAL_EXAMPLES.kindia.lng,
    dropoffLat: NATIONAL_EXAMPLES.labe.lat,
    dropoffLng: NATIONAL_EXAMPLES.labe.lng,
    vehicleClass: "standard",
  });
  assert.equal(decision.kind, "reject");
  if (decision.kind === "reject") assert.equal(decision.error, "guinea_market_disabled");
}));

pending.push(test("places across Guinea resolve to the same national market", () => {
  assert.equal(isGuineaMarketEnabled({ GUINEA_MARKET_ENABLED: "true" }), true);
  for (const place of Object.values(NATIONAL_EXAMPLES)) {
    assert.equal(coordinatesInGuineaNationalExtent(place.lat, place.lng), true);
    const decision = resolveGuineaTaxiMarket({
      enabled: true,
      claimedCountryCode: "US",
      pickupLat: CONAKRY.lat,
      pickupLng: CONAKRY.lng,
      dropoffLat: place.lat,
      dropoffLng: place.lng,
      vehicleClass: "standard",
    });
    assert.equal(decision.kind, "guinea");
  }
  const inside = resolveGuineaTaxiMarket({
    enabled: true,
    claimedCountryCode: "US",
    pickupLat: KALOUM.lat,
    pickupLng: KALOUM.lng,
    dropoffLat: NATIONAL_EXAMPLES.nzerekore.lat,
    dropoffLng: NATIONAL_EXAMPLES.nzerekore.lng,
    vehicleClass: "standard",
  });
  assert.equal(inside.kind, "guinea");
}));

pending.push(test("a trip that leaves Guinea is not priced as US dollars", () => {
  const decision = resolveGuineaTaxiMarket({
    enabled: true,
    claimedCountryCode: "GN",
    pickupLat: CONAKRY.lat,
    pickupLng: CONAKRY.lng,
    dropoffLat: NYC.lat,
    dropoffLng: NYC.lng,
    vehicleClass: "standard",
  });
  assert.equal(decision.kind, "reject");
  if (decision.kind === "reject") assert.equal(decision.error, "outside_guinea");
}));

pending.push(test("reverse-geocode evidence is required and a neighbor country is rejected", () => {
  assert.equal(guineaCountryEvidenceAllowsMarket([]), false);
  assert.equal(guineaCountryEvidenceAllowsMarket([null, null]), false);
  assert.equal(guineaCountryEvidenceAllowsMarket(["GN", null]), false);
  assert.equal(guineaCountryEvidenceAllowsMarket(["GN", "GN"]), true);
  assert.equal(guineaCountryEvidenceAllowsMarket(["GN", "SL"]), false);
  assert.equal(guineaCountryEvidenceAllowsMarket(["ML", "GN"]), false);
}));

pending.push(test("a place name is stored as the locality and coordinates are not a city", () => {
  assert.equal(localityLabel("Kindia, Guinea"), "Kindia");
  assert.equal(localityLabel("9.64110, -13.57840"), null);
  assert.equal(localityLabel(""), null);
}));

pending.push(test("the market module has no city allow-list", () => {
  const source = fs.readFileSync(
    path.join(root, "apps/web/src/lib/markets/guineaMarket.ts"),
    "utf8",
  );
  assert.equal(source.includes("GUINEA_SERVICE_CITIES"), false);
  assert.equal(source.includes("allowed_cities"), false);
  assert.equal(source.includes("CONAKRY_ONLY"), false);
  assert.equal(source.includes("outside_guinea_service_city"), false);
}));

pending.push(test("a point inside the rectangle is not Guinea until Mapbox says GN", () => {
  for (const place of Object.values(RECTANGLE_NEIGHBORS)) {
    assert.equal(coordinatesInGuineaNationalExtent(place.lat, place.lng), true);
    assert.equal(
      guineaCountryEvidenceAllowsMarket([place.country, place.country]),
      false,
    );
    const claimed = resolveGuineaTaxiMarket({
      enabled: true,
      claimedCountryCode: "GN",
      pickupLat: place.lat,
      pickupLng: place.lng,
      dropoffLat: place.lat + 0.01,
      dropoffLng: place.lng,
      vehicleClass: "standard",
    });
    assert.equal(claimed.kind, "guinea");
  }
  assert.equal(guineaCountryEvidenceAllowsMarket(["SL", "GN"]), false);
  assert.equal(guineaCountryEvidenceAllowsMarket(["US", "US"]), false);
  const nycClaim = resolveGuineaTaxiMarket({
    enabled: true,
    claimedCountryCode: "GN",
    pickupLat: NYC.lat,
    pickupLng: NYC.lng,
    dropoffLat: 40.75,
    dropoffLng: -73.99,
    vehicleClass: "standard",
  });
  assert.equal(nycClaim.kind, "reject");
  if (nycClaim.kind === "reject") assert.equal(nycClaim.error, "market_mismatch");
}));

pending.push(test("non-finite coordinates are rejected", () => {
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const decision = resolveGuineaTaxiMarket({
      enabled: true,
      pickupLat: bad,
      pickupLng: -13.5,
      dropoffLat: CONAKRY.lat,
      dropoffLng: CONAKRY.lng,
    });
    assert.equal(decision.kind, "reject");
    if (decision.kind === "reject") assert.equal(decision.error, "invalid_coordinates");
  }
}));

pending.push(test("invalid coordinates are rejected", () => {
  const decision = resolveGuineaTaxiMarket({
    enabled: true,
    pickupLat: 0,
    pickupLng: 0,
    dropoffLat: CONAKRY.lat,
    dropoffLng: CONAKRY.lng,
  });
  assert.equal(decision.kind, "reject");
  if (decision.kind === "reject") assert.equal(decision.error, "invalid_coordinates");
}));

pending.push(test("GNF fare uses the configured integer formula and ignores no client amount", () => {
  const fare = calculateGuineaTaxiFareGnf({
    distanceMeters: 8_400,
    durationMinutes: 24,
    card: TEST_CARD,
  });
  assert.equal(fare.ok, true);
  if (fare.ok) {
    assert.equal(fare.fareGnf, 5_000 + 16_800 + 12_000);
    assert.equal(Number.isInteger(fare.fareGnf), true);
  }
  assert.match(formatGuineaFare(85_000), /85[\s\u202f\u00a0]000 GNF/);
  assert.equal(readGuineaTaxiRateCard({}).ok, false);
}));

pending.push(test("fare above the configured maximum is rejected", () => {
  const fare = calculateGuineaTaxiFareGnf({
    distanceMeters: 20_000,
    durationMinutes: 60,
    card: { ...TEST_CARD, maximumFareGnf: 30_000 },
  });
  assert.equal(fare.ok, false);
  if (fare.ok === false) assert.equal(fare.error, "fare_above_maximum");
}));

pending.push(test("an intercity distance uses the national fare card", () => {
  const fare = calculateGuineaTaxiFareGnf({
    distanceMeters: 80_000,
    durationMinutes: 90,
    card: TEST_CARD,
  });
  assert.equal(fare.ok, true);
  if (fare.ok === true) assert.equal(fare.fareGnf, 210_000);
}));

pending.push(test("cash rides never enter the Stripe transfer path", () => {
  assert.equal(taxiCashSkipsStripe("pending_cash"), true);
  assert.equal(taxiCashSkipsStripe("cash_collected"), true);
  assert.equal(taxiCashSkipsStripe("paid"), false);
  assert.equal(taxiCashSkipsStripe("unpaid"), false);
}));

pending.push(test("USD dispatch still requires paid, cash pending can dispatch once", () => {
  assert.equal(taxiPaymentAllowsDispatch("paid", null), true);
  assert.equal(taxiPaymentAllowsDispatch("paid", "card"), true);
  assert.equal(taxiPaymentAllowsDispatch("unpaid", "card"), false);
  assert.equal(taxiPaymentAllowsDispatch("pending_cash", "cash"), true);
  assert.equal(taxiPaymentAllowsDispatch("pending_cash", "card"), false);
  assert.equal(taxiPaymentAllowsDispatch("cash_collected", "cash"), false);
}));

pending.push(test("only the assigned driver can collect cash, and a second time is idempotent", () => {
  const ride = cashRide();
  assert.equal(evaluateCashCollection(ride, "client-1").ok, false);
  assert.equal(evaluateCashCollection(ride, "driver-2").ok, false);
  const first = evaluateCashCollection(ride, "driver-1");
  assert.equal(first.ok, true);
  if (first.ok) {
    assert.equal(first.idempotent, false);
    assert.equal(first.fareGnf, 85_000);
  }
  const second = evaluateCashCollection(
    cashRide({ paymentStatus: "cash_collected" }),
    "driver-1",
  );
  assert.equal(second.ok, true);
  if (second.ok) assert.equal(second.idempotent, true);
  const ledger = buildCashCollectionLedgerRow({
    rideId: "ride-1",
    driverUserId: "driver-1",
    fareGnf: first.ok ? first.fareGnf : 0,
  });
  assert.equal(ledger.reference_type, "cash_collection");
  assert.equal(ledger.amount_cents, 85_000);
  assert.equal(ledger.currency, "GNF");
  const again = buildCashCollectionLedgerRow({
    rideId: "ride-1",
    driverUserId: "driver-1",
    fareGnf: 85_000,
  });
  assert.equal(again.reference_id, ledger.reference_id);
  assert.equal(again.amount_cents, ledger.amount_cents);
}));

pending.push(test("two cash confirmations at the same time keep a single ledger row", async () => {
  const ride = {
    id: "ride-race",
    client_user_id: "client-1",
    driver_id: "driver-1",
    status: "completed",
    payment_method: "cash",
    payment_status: "pending_cash",
    currency: "GNF",
    country_code: "GN",
    total_cents: 85_000,
  };
  const ledger: Array<Record<string, unknown>> = [];

  function query(read: () => { data: unknown; error: unknown }) {
    const api: object = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") return undefined;
          if (prop === "maybeSingle") return async () => read();
          return () => api;
        },
      },
    );
    return api;
  }

  const client = {
    from(table: string) {
      return {
        select() {
          return query(() => {
            if (table === "taxi_rides") return { data: { ...ride }, error: null };
            const row = ledger.find((item) => item.reference_id === ride.id);
            return { data: row ? { id: "ledger-1" } : null, error: null };
          });
        },
        update(patch: { payment_status?: string }) {
          return query(() => {
            if (ride.payment_status !== "pending_cash") return { data: null, error: null };
            ride.payment_status = String(patch.payment_status ?? "");
            return {
              data: {
                id: ride.id,
                total_cents: ride.total_cents,
                payment_status: ride.payment_status,
              },
              error: null,
            };
          });
        },
        insert(row: Record<string, unknown>) {
          const duplicate = ledger.some(
            (item) =>
              item.reference_type === "cash_collection" && item.reference_id === row.reference_id,
          );
          if (duplicate) {
            return Promise.resolve({
              error: {
                message: "duplicate key value violates unique constraint wallet_ledger_cash_collection_once",
              },
            });
          }
          ledger.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  };

  const { collectGuineaCash } = await import("./guineaTaxiHttp");
  const [first, second] = await Promise.all([
    collectGuineaCash({
      supabaseAdmin: client as never,
      actorUserId: "driver-1",
      rideId: ride.id,
    }),
    collectGuineaCash({
      supabaseAdmin: client as never,
      actorUserId: "driver-1",
      rideId: ride.id,
    }),
  ]);
  const left = (await first.json()) as { ok?: boolean; ledger_recorded?: boolean };
  const right = (await second.json()) as { ok?: boolean; ledger_recorded?: boolean };
  assert.equal(left.ok, true);
  assert.equal(right.ok, true);
  assert.equal(left.ledger_recorded, true);
  assert.equal(right.ledger_recorded, true);
  assert.equal(ledger.length, 1);
  assert.equal(ledger[0]?.reference_type, "cash_collection");
  assert.equal(ledger[0]?.reference_id, ride.id);
  assert.equal(ledger[0]?.amount_cents, 85_000);
}));

pending.push(test("canceled and wrong-currency rides cannot be marked cash collected", () => {
  assert.equal(evaluateCashCollection(cashRide({ status: "canceled" }), "driver-1").ok, false);
  const currency = evaluateCashCollection(cashRide({ currency: "USD" }), "driver-1");
  assert.equal(currency.ok, false);
  if (currency.ok === false) assert.equal(currency.error, "currency_mismatch");
  const market = evaluateCashCollection(cashRide({ countryCode: "US" }), "driver-1");
  assert.equal(market.ok, false);
  if (market.ok === false) assert.equal(market.error, "market_mismatch");
  const missing = evaluateCashCollection(null, "driver-1");
  assert.equal(missing.ok, false);
  if (missing.ok === false) assert.equal(missing.error, "ride_not_found");
  const open = evaluateCashCollection(cashRide({ status: "in_progress" }), "driver-1");
  assert.equal(open.ok, false);
  if (open.ok === false) assert.equal(open.error, "ride_not_completed");
}));

pending.push(test("Orange Money stays disabled and does not call the network", async () => {
  const previous = process.env.ORANGE_MONEY_GN_ENABLED;
  process.env.ORANGE_MONEY_GN_ENABLED = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("orange network must not be called");
  };
  try {
    assert.equal(isOrangeMoneyGuineaEnabled(), false);
    assert.equal(orangeMoneyGuineaConfig().enabled, false);
    assert.equal(ORANGE_MONEY_STATUSES.includes("paid"), true);
    const initiated = await orangeMoneyGuineaAdapter.initiate({
      transactionId: "tx-test",
      amountCents: 1000,
      currency: "GNF",
      countryCode: "GN",
      methodCode: "orange_money",
      description: "test",
      returnUrl: "https://example.test/return",
      notifyUrl: "https://example.test/notify",
      testMode: true,
    });
    assert.equal(initiated.ok, false);
    if (initiated.ok === false) assert.equal(initiated.error, "orange_money_disabled");
    const status = await orangeMoneyGuineaAdapter.fetchStatus("ref", true);
    assert.equal(status.ok, false);
  } finally {
    globalThis.fetch = originalFetch;
    if (previous == null) delete process.env.ORANGE_MONEY_GN_ENABLED;
    else process.env.ORANGE_MONEY_GN_ENABLED = previous;
  }
}));

pending.push(test("Guinea modules do not hardcode Orange credentials", () => {
  const files = [
    "apps/web/src/lib/markets/guineaMarket.ts",
    "apps/web/src/lib/markets/guineaTaxiPricing.ts",
    "apps/web/src/lib/markets/guineaCashPayment.ts",
    "apps/web/src/lib/markets/guineaOrangeMoney.ts",
    "apps/web/src/lib/markets/guineaTaxiHttp.ts",
  ];
  for (const file of files) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.equal(/client_secret\s*[:=]\s*["'][^"']+["']/.test(source), false, file);
    assert.equal(/sk_live_/.test(source), false, file);
    assert.equal(/https:\/\/api\.orange\.com/.test(source), false, file);
  }
}));

pending.push(test("admin revenue keeps USD and GNF in separate totals", () => {
  const now = new Date("2026-10-08T15:00:00");
  const today = "2026-10-08T12:00:00";
  const row = (partial: Partial<AdminTaxiRideListItem>): AdminTaxiRideListItem =>
    ({
      id: "1",
      status: "completed",
      vehicle_class: "standard",
      payment_status: "paid",
      refund_status: null,
      total_cents: 2500,
      currency: "USD",
      client_user_id: null,
      driver_id: null,
      pickup_address: null,
      dropoff_address: null,
      pickup_city: "New York",
      distance_miles: 1,
      duration_minutes: 10,
      next_ride_eta_minutes: null,
      created_at: today,
      completed_at: today,
      accepted_at: null,
      driver_arrived_at: null,
      started_at: null,
      updated_at: null,
      driver_is_online: null,
      client: null,
      driver: null,
      vehicle: null,
      ...partial,
    }) as AdminTaxiRideListItem;
  const items = [
    row({ id: "us", total_cents: 2500, currency: "USD" }),
    row({
      id: "gn",
      total_cents: 85_000,
      currency: "GNF",
      payment_status: "cash_collected",
      country_code: "GN",
      payment_method: "cash",
      pickup_city: "Conakry",
    }),
  ];
  assert.equal(revenueTodayCents(items, now), 2500);
  const split = revenueTodayByCurrency(items, now);
  assert.deepEqual(
    split.map((entry) => entry.currency),
    ["GNF", "USD"],
  );
  const label = formatRevenueToday(split);
  assert.match(label, /GNF/);
  assert.match(label, /\$25\.00/);
  assert.equal(label.includes("850.00"), false);
  assert.match(formatRideMoney(85_000, "GNF"), /85[\s\u202f\u00a0]000/);
  assert.equal(formatRideMoney(2500, "USD"), "$25.00");
}));

pending.push(test("the migration adds cash fields without rewriting historical rides", () => {
  const sql = fs.readFileSync(
    path.join(root, "supabase/pending/20261017120000_guinea_cash_taxi.sql"),
    "utf8",
  );
  assert.match(sql, /pending_cash/);
  assert.match(sql, /cash_collected/);
  assert.match(sql, /cash_collection/);
  assert.match(sql, /payment_method/);
  assert.match(sql, /taxi_ride_payment_allows_dispatch/);
  assert.match(sql, /wallet_ledger_cash_collection_once/);
  assert.match(sql, /guard_taxi_rides_client_financial_update/);
  assert.match(sql, /current_user::text = 'service_role'/);
  assert.match(sql, /auth\.role\(\)/);
  assert.match(sql, /payment_method/);
  assert.match(sql, /'stripe', 'business_wallet', 'cash'/);
  assert.match(sql, /'paid', 'pending_cash'/);
  assert.equal(/set\s+currency\s*=/i.test(sql), false);
  assert.equal(/set\s+total_cents\s*=/i.test(sql), false);
  assert.equal(/^as \$$/m.test(sql), false);
  assert.equal(/^\$;$/m.test(sql), false);
  assert.match(sql, /as \$\$/);
  assert.equal(/update\s+public\.taxi_rides\s+set\s+currency/i.test(sql), false);
}));

pending.push(test("missing geocoder country is not treated as Guinea and the test fare is not a default", () => {
  assert.equal(readGuineaTaxiRateCard({}).ok, false);
  const pricing = fs.readFileSync(
    path.join(root, "apps/web/src/lib/markets/guineaTaxiPricing.ts"),
    "utf8",
  );
  assert.equal(pricing.includes("5_000"), false);
  assert.equal(pricing.includes("2_000"), false);
  const http = fs.readFileSync(
    path.join(root, "apps/web/src/lib/markets/guineaTaxiHttp.ts"),
    "utf8",
  );
  assert.match(http, /detectTaxiCountryFromCoords/);
  const validateAt = http.indexOf("validateRouteClaimsServer");
  const validateBlock = http.slice(validateAt, validateAt + 700);
  assert.equal(validateBlock.includes("claimedCountryCode"), false);
  const freetown = coordinatesInGuineaNationalExtent(8.484, -13.234);
  const bamako = coordinatesInGuineaNationalExtent(12.639, -8.003);
  assert.equal(freetown, true);
  assert.equal(bamako, true);
  assert.equal(guineaCountryEvidenceAllowsMarket(["SL", "SL"]), false);
  assert.equal(guineaCountryEvidenceAllowsMarket(["ML", "ML"]), false);
}));

async function main() {
  await Promise.all(pending);
  console.log("guineaMarket.test.ts passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
