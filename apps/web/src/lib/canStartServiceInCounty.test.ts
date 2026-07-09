import assert from "node:assert/strict";
import {
  canDriverReceiveRequestsInCounty,
  canStartServiceInCounty,
  clientServiceUnavailableCopy,
  type CountyServiceToggleSnapshot,
} from "./canStartServiceInCounty";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

function county(
  code: string,
  overrides: Partial<CountyServiceToggleSnapshot> = {}
): CountyServiceToggleSnapshot {
  return {
    county_code: code,
    county_name: code,
    platform_enabled: true,
    taxi_enabled: true,
    delivery_enabled: true,
    restaurant_enabled: true,
    marketplace_enabled: true,
    checkout_enabled: true,
    maintenance_mode: false,
    ...overrides,
  };
}

test("Nassau ON → Suffolk OFF → course autorisée", () => {
  const result = canStartServiceInCounty({
    service: "taxi",
    originCounty: county("nassau"),
    destinationCounty: county("suffolk", { platform_enabled: false }),
  });
  assert.equal(result.allowed, true);
  assert.equal(result.code, "allowed");
  assert.equal(result.destination_county_off, true);
});

test("Suffolk OFF → Nassau ON → refus avec message clair", () => {
  const result = canStartServiceInCounty({
    service: "taxi",
    originCounty: county("suffolk", { platform_enabled: false }),
    destinationCounty: county("nassau"),
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "origin_county_off");
  assert.equal(result.title, "Service not available yet");
  assert.match(result.message ?? "", /not available in your pickup area/i);
});

test("Suffolk OFF → Suffolk OFF → refus avec message clair", () => {
  const result = canStartServiceInCounty({
    service: "delivery",
    originCounty: county("suffolk", { platform_enabled: false }),
    destinationCounty: county("suffolk", { platform_enabled: false }),
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "origin_county_off");
});

test("Taxi OFF → message Taxi indisponible", () => {
  const result = canStartServiceInCounty({
    service: "taxi",
    originCounty: county("nassau", { taxi_enabled: false }),
    destinationCounty: county("suffolk"),
  });
  assert.equal(result.allowed, false);
  assert.equal(result.code, "origin_service_off");
  assert.equal(result.message, clientServiceUnavailableCopy("taxi").message);
});

test("Delivery OFF → message Delivery indisponible", () => {
  const result = canStartServiceInCounty({
    service: "delivery",
    originCounty: county("nassau", { delivery_enabled: false }),
  });
  assert.equal(result.allowed, false);
  assert.match(result.message ?? "", /Delivery service is not available/i);
});

test("Food OFF → restaurants cachés + message propriétaire", () => {
  const result = canStartServiceInCounty({
    service: "food",
    originCounty: county("nassau", { restaurant_enabled: false }),
  });
  assert.equal(result.allowed, false);
  assert.match(result.message ?? "", /Food delivery is not available/i);
});

test("Marketplace OFF → stores cachés + message vendeur", () => {
  const result = canStartServiceInCounty({
    service: "marketplace",
    originCounty: county("nyc", { marketplace_enabled: false }),
  });
  assert.equal(result.allowed, false);
  assert.match(result.message ?? "", /Marketplace is not available/i);
});

test("Driver arrive dans county OFF → Out of Service Area", () => {
  const result = canDriverReceiveRequestsInCounty(
    county("suffolk", { platform_enabled: false })
  );
  assert.equal(result.can_receive_requests, false);
  assert.equal(result.out_of_service_area, true);
  assert.equal(result.status, "Out of Service Area");
  assert.match(result.message ?? "", /not operating yet/i);
});

test("Driver retourne dans county ON → disponible automatiquement", () => {
  const result = canDriverReceiveRequestsInCounty(county("nassau"));
  assert.equal(result.can_receive_requests, true);
  assert.equal(result.out_of_service_area, false);
  assert.equal(result.status, null);
});

console.log("canStartServiceInCounty tests passed");
