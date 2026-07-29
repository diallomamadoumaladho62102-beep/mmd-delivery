/**
 * Pure-node proof of service-preferences sanitize (no RN imports).
 */
import assert from "node:assert/strict";

const SERVICE_PREFERENCE_PATCH_KEYS = [
  "food_delivery_enabled",
  "package_delivery_enabled",
  "taxi_rides_enabled",
  "accept_also_standard_rides",
];

function sanitizeDriverServicePreferencesPatch(patch) {
  const out = {};
  for (const key of SERVICE_PREFERENCE_PATCH_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patch, key) && patch[key] !== undefined) {
      out[key] = Boolean(patch[key]);
    }
  }
  return out;
}

const payloadBefore = {
  driver_user_id: "07c4d779-bb64-43ba-99a8-a04fb23c069b",
  updated_at: "2026-07-29T00:00:00.000Z",
  food_delivery_enabled: true,
  package_delivery_enabled: false,
  taxi_rides_enabled: true,
  accept_also_standard_rides: false,
};

const payloadAfter = sanitizeDriverServicePreferencesPatch(payloadBefore);

assert.deepEqual(payloadAfter, {
  food_delivery_enabled: true,
  package_delivery_enabled: false,
  taxi_rides_enabled: true,
  accept_also_standard_rides: false,
});

console.log(
  JSON.stringify(
    {
      ok: true,
      payload_before: payloadBefore,
      payload_after: payloadAfter,
      stripped_fields: ["driver_user_id", "updated_at"],
    },
    null,
    2,
  ),
);
