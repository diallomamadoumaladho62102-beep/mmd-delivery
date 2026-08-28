import assert from "node:assert/strict";
import { canonicalizeClientAiRoute } from "./aiClientRoutes";

assert.equal(canonicalizeClientAiRoute("TaxiHome"), "TaxiHome");
assert.equal(canonicalizeClientAiRoute("Taxi"), "TaxiHome");
assert.equal(canonicalizeClientAiRoute("taxi"), "TaxiHome");
assert.equal(canonicalizeClientAiRoute("OpenTaxi"), "TaxiHome");
assert.equal(canonicalizeClientAiRoute("#"), null);
assert.equal(canonicalizeClientAiRoute("javascript:void(0)"), null);
assert.equal(canonicalizeClientAiRoute("ClientRestaurantList"), "ClientRestaurantList");
assert.equal(canonicalizeClientAiRoute("Food"), "ClientRestaurantList");
assert.equal(canonicalizeClientAiRoute("DeliveryRequest"), "DeliveryRequest");
assert.equal(canonicalizeClientAiRoute("NotARealScreen"), null);

console.log("aiClientRoutes.test.ts OK");
