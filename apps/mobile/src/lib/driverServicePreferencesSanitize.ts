/**
 * Pure sanitize/normalize helpers for driver service preferences.
 * Kept free of React Native / AsyncStorage so Node tests can import them.
 */

/** Only these keys may be sent on PATCH /api/driver/service-preferences. */
export const SERVICE_PREFERENCE_PATCH_KEYS = [
  "food_delivery_enabled",
  "package_delivery_enabled",
  "taxi_rides_enabled",
  "accept_also_standard_rides",
] as const;

export type DriverServicePreferences = {
  food_delivery_enabled: boolean;
  package_delivery_enabled: boolean;
  taxi_rides_enabled: boolean;
  accept_also_standard_rides: boolean;
};

export function normalizeDriverServicePreferences(
  raw: unknown,
): DriverServicePreferences {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    food_delivery_enabled: Boolean(row.food_delivery_enabled),
    package_delivery_enabled: Boolean(row.package_delivery_enabled),
    taxi_rides_enabled: Boolean(row.taxi_rides_enabled),
    accept_also_standard_rides: Boolean(row.accept_also_standard_rides),
  };
}

/**
 * Strip server-owned fields (driver_user_id, updated_at, …) before PATCH.
 * GET preferences include those fields; spreading them into PATCH caused 403 forbidden_field.
 */
export function sanitizeDriverServicePreferencesPatch(
  patch: Partial<DriverServicePreferences> & Record<string, unknown>,
): Partial<DriverServicePreferences> {
  const out: Partial<DriverServicePreferences> = {};
  for (const key of SERVICE_PREFERENCE_PATCH_KEYS) {
    if (
      Object.prototype.hasOwnProperty.call(patch, key) &&
      patch[key] !== undefined
    ) {
      out[key] = Boolean(patch[key]);
    }
  }
  return out;
}
