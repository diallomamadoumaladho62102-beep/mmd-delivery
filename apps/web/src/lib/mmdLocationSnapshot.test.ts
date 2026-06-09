import assert from "node:assert/strict";
import {
  buildAddressFromLocationPoint,
  toLocationRouteSnapshot,
} from "./mmdLocationSnapshot";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("buildAddressFromLocationPoint prefers formatted_address", () => {
  assert.equal(
    buildAddressFromLocationPoint({
      formatted_address: "123 Main St",
      directions_text: "Near mosque",
      pin_lat: 9.5,
      pin_lng: -13.7,
    }),
    "123 Main St"
  );
});

test("buildAddressFromLocationPoint falls back to directions_text", () => {
  assert.equal(
    buildAddressFromLocationPoint({
      formatted_address: "",
      directions_text: "Behind Total station",
      pin_lat: 9.5,
      pin_lng: -13.7,
    }),
    "Behind Total station"
  );
});

test("toLocationRouteSnapshot maps pin and address", () => {
  const snapshot = toLocationRouteSnapshot({
    id: "00000000-0000-4000-8000-000000000001",
    owner_user_id: "00000000-0000-4000-8000-000000000002",
    country_code: "GN",
    region_name: "Conakry",
    prefecture_name: null,
    city_name: "Conakry",
    commune_name: "Kaloum",
    quartier_name: null,
    formatted_address: "Kaloum centre",
    directions_text: "Face à la mosquée",
    geocoded_lat: null,
    geocoded_lng: null,
    pin_lat: 9.5092,
    pin_lng: -13.7122,
    accuracy_m: 12,
    location_source: "pin",
    primary_landmark_id: null,
    location_photo_path: null,
    confidence_score: 80,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  });

  assert.equal(snapshot.locationId, "00000000-0000-4000-8000-000000000001");
  assert.equal(snapshot.lat, 9.5092);
  assert.equal(snapshot.lng, -13.7122);
  assert.equal(snapshot.address, "Kaloum centre");
  assert.equal(snapshot.directionsText, "Face à la mosquée");
});

console.log("mmdLocationSnapshot tests passed");
