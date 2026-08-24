import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeRatingCategories,
  TAXI_CLIENT_RATES_DRIVER_CATEGORIES,
  TAXI_DRIVER_RATES_CLIENT_CATEGORIES,
} from "./taxiRatingCategories";
import {
  planClientTaxiCancellation,
  resolveTaxiClientCancelPhase,
} from "./taxiCancellationPolicy";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

function read(rel: string) {
  return readFileSync(join(process.cwd(), rel), "utf8");
}

test("rating categories whitelist", () => {
  assert.ok(TAXI_CLIENT_RATES_DRIVER_CATEGORIES.includes("great_driver"));
  assert.ok(TAXI_DRIVER_RATES_CLIENT_CATEGORIES.includes("excellent_customer"));
  assert.deepEqual(
    normalizeRatingCategories(
      ["great_driver", "hacked", "polite"],
      TAXI_CLIENT_RATES_DRIVER_CATEGORIES,
    ),
    ["great_driver", "polite"],
  );
});

test("driver cancel route redispatches and does not refund", () => {
  const src = read("app/api/taxi/rides/driver-cancel/route.ts");
  assert.match(src, /runTaxiRideDispatch/);
  assert.match(src, /reassign:\s*true/);
  assert.doesNotMatch(src, /stripe\.refunds\.create/);
  assert.match(src, /activity_impact/);
});

test("client cancel route applies 30% / 100% policy engine", () => {
  const src = read("app/api/taxi/rides/cancel/route.ts");
  assert.match(src, /planClientTaxiCancellation/);
  assert.match(src, /after_accept_before_start/);
  assert.match(src, /PARTIAL|partially_refunded/);
  assert.match(src, /preview/);
});

test("destination + add-stop APIs enforce taxi distance limit", () => {
  const dest = read("app/api/taxi/rides/change-destination/route.ts");
  const stop = read("app/api/taxi/rides/add-stop/route.ts");
  assert.match(dest, /assertRouteDistanceWithinLimit/);
  assert.match(stop, /assertRouteDistanceWithinLimit/);
  assert.match(dest, /additional_payment_required/);
  assert.match(stop, /max_stops/);
});

test("migration replaces driver cancel with release+reassign", () => {
  const mig = read(
    "../../supabase/migrations/20261125150000_taxi_cancel_reassign_ratings.sql",
  );
  assert.match(mig, /driver_release_reassign/);
  assert.match(mig, /reassign',\s*true/);
  assert.match(mig, /taxi_ride_route_changes/);
  assert.match(mig, /ratee_role/);
});

test("ratee_role guard keeps driver→client out of driver summary", () => {
  const mig = read(
    "../../supabase/migrations/20261125160000_taxi_rating_ratee_role_guard.sql",
  );
  assert.match(mig, /coalesce\(tr\.ratee_role, 'driver'\) = 'driver'/);
  assert.match(mig, /coalesce\(new\.ratee_role, 'driver'\) <> 'driver'/);
  const route = read("app/api/taxi/rides/[id]/rating/route.ts");
  assert.match(route, /driver_rating_summary/);
  assert.match(route, /only_client_rates_driver/);
});

test("policy: after accept 30%, after start 50/100 driver", () => {
  assert.equal(
    resolveTaxiClientCancelPhase({ status: "accepted", driverId: "x" }),
    "after_accept_before_start",
  );
  const a = planClientTaxiCancellation({
    status: "accepted",
    driverId: "x",
    paymentStatus: "paid",
    totalCents: 2000,
    driverPayoutCents: 1400,
  });
  assert.equal(a.ok, true);
  if (!a.ok || a.phase !== "after_accept_before_start") {
    throw new Error("expected after_accept_before_start");
  }
  assert.equal(a.cancelFeeCents, 600);
});

console.log("taxiCancelDestinationRatings regression passed");
