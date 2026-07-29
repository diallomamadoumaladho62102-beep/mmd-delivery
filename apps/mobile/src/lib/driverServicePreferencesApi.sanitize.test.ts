import assert from "node:assert/strict";
import {
  normalizeDriverServicePreferences,
  sanitizeDriverServicePreferencesPatch,
} from "./driverServicePreferencesApi";

function testSanitizeStripsServerOwnedFields() {
  const before = {
    driver_user_id: "07c4d779-bb64-43ba-99a8-a04fb23c069b",
    updated_at: "2026-07-29T00:00:00.000Z",
    food_delivery_enabled: true,
    package_delivery_enabled: false,
    taxi_rides_enabled: true,
    accept_also_standard_rides: false,
    created_at: "2026-01-01T00:00:00.000Z",
  };

  const after = sanitizeDriverServicePreferencesPatch(before);

  assert.deepEqual(after, {
    food_delivery_enabled: true,
    package_delivery_enabled: false,
    taxi_rides_enabled: true,
    accept_also_standard_rides: false,
  });
  assert.equal(
    Object.prototype.hasOwnProperty.call(after, "driver_user_id"),
    false,
  );
  assert.equal(Object.prototype.hasOwnProperty.call(after, "updated_at"), false);
}

function testNormalizeFromApiGetShape() {
  const normalized = normalizeDriverServicePreferences({
    driver_user_id: "abc",
    updated_at: "2026-07-29T00:00:00.000Z",
    food_delivery_enabled: 1,
    package_delivery_enabled: 0,
    taxi_rides_enabled: true,
    accept_also_standard_rides: false,
  });
  assert.deepEqual(normalized, {
    food_delivery_enabled: true,
    package_delivery_enabled: false,
    taxi_rides_enabled: true,
    accept_also_standard_rides: false,
  });
}

testSanitizeStripsServerOwnedFields();
testNormalizeFromApiGetShape();
console.log("driverServicePreferencesApi.sanitize.test.ts OK");
console.log(
  JSON.stringify(
    {
      payload_before: {
        driver_user_id: "…",
        updated_at: "…",
        food_delivery_enabled: true,
        package_delivery_enabled: false,
        taxi_rides_enabled: true,
        accept_also_standard_rides: false,
      },
      payload_after: sanitizeDriverServicePreferencesPatch({
        driver_user_id: "…",
        updated_at: "…",
        food_delivery_enabled: true,
        package_delivery_enabled: false,
        taxi_rides_enabled: true,
        accept_also_standard_rides: false,
      }),
    },
    null,
    2,
  ),
);
