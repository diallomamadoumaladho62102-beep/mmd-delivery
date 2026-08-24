/**
 * Structured rating categories for taxi (client↔driver).
 * Free-text is optional and must not be logged to Sentry.
 */

export const TAXI_CLIENT_RATES_DRIVER_CATEGORIES = [
  "great_driver",
  "polite",
  "good_driver",
  "rude_driver",
  "car_was_clean",
  "car_was_dirty",
  "wrong_route",
  "asked_different_route",
  "vehicle_mismatch",
  "driver_photo_mismatch",
  "unsafe_driving",
  "other",
] as const;

export const TAXI_DRIVER_RATES_CLIENT_CATEGORIES = [
  "excellent_customer",
  "on_time",
  "late_pickup",
  "bad_behavior",
  "very_dirty",
  "aggressive",
  "unsafe_behavior",
  "asked_different_route",
  "other",
] as const;

export type TaxiRateeRole = "driver" | "client";

export function normalizeRatingCategories(
  raw: unknown,
  allowed: readonly string[],
): string[] {
  const list = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(",")
      : [];
  const out: string[] = [];
  for (const item of list) {
    const code = String(item ?? "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .slice(0, 64);
    if (code && allowed.includes(code) && !out.includes(code)) {
      out.push(code);
    }
  }
  return out.slice(0, 8);
}

export function sanitizeRatingFreeText(value: unknown): string | null {
  const text = String(value ?? "").trim().slice(0, 500);
  return text.length > 0 ? text : null;
}
