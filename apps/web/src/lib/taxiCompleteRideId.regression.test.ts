import assert from "node:assert/strict";
import { mapTaxiRpcError } from "./taxiDriver";
import { getTaxiRideId } from "./taxiApi";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("getTaxiRideId accepts taxi_ride_id UUID", () => {
  const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  assert.equal(getTaxiRideId({ taxi_ride_id: id }), id);
});

test("getTaxiRideId rejects missing and invalid ids", () => {
  assert.throws(() => getTaxiRideId({}), /Missing taxi_ride_id/);
  assert.throws(
    () => getTaxiRideId({ taxi_ride_id: "not-a-uuid" }),
    /Invalid taxi_ride_id/,
  );
});

test("RPC ride_not_found maps to Not found (not raw code)", () => {
  const mapped = mapTaxiRpcError("ride_not_found");
  assert.equal(mapped.status, 404);
  assert.equal(mapped.message, "Not found");
});

test("RPC invalid_status stays conflict for already-completed rides", () => {
  const mapped = mapTaxiRpcError("invalid_status");
  assert.equal(mapped.status, 409);
});

console.log("taxiCompleteRideId regression passed");
