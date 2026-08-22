import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  taxiDriverArrivedDedupKey,
  taxiDriverEtaDedupKey,
  taxiRideAcceptedDedupKey,
} from "./clientPushNotifications";

test("taxi push dedup keys are stable", () => {
  assert.equal(
    taxiRideAcceptedDedupKey("ride-1"),
    "taxi_ride_accepted:ride-1",
  );
  assert.equal(
    taxiDriverArrivedDedupKey("taxi_rides", "ride-1"),
    "taxi_driver_arrived:taxi_rides:ride-1",
  );
  assert.equal(taxiDriverEtaDedupKey("ride-1", 8), "taxi_driver_eta:ride-1:9");
  assert.equal(taxiDriverEtaDedupKey("ride-1", 7), "taxi_driver_eta:ride-1:6");
});

test("client push notifications use dedup + ETA helper", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(dir, "clientPushNotifications.ts"), "utf8");
  assert.match(src, /notifyClientTaxiDriverEnRoute/);
  assert.match(src, /wasTaxiPushAlreadySent/);
  assert.match(src, /Driver assigned/);
  assert.match(src, /Your driver has arrived/);
});

test("taxi accept route sends assigned + ETA pushes", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(
    path.join(dir, "../../app/api/taxi/offers/accept/route.ts"),
    "utf8",
  );
  assert.match(src, /notifyClientTaxiRideAccepted/);
  assert.match(src, /notifyClientTaxiDriverEnRoute/);
  assert.match(src, /duration_minutes/);
});
