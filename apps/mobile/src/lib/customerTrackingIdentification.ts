/**
 * Reads the real taxi ride identification payload (snapshot + nested object).
 * Field names match `TaxiRideIdentification` / ride row — no invented values.
 */

export type CustomerTrackingIdentification = {
  driverName: string;
  driverPhoto: string;
  driverRating: number | null;
  driverTrips: number | null;
  vehicleLabel: string;
  vehiclePlate: string;
  vehicleYear: number | null;
  vehiclePhoto: string;
  vehicleMake: string;
  vehicleModel: string;
  vehicleColor: string;
};

function trimStr(value: unknown): string {
  return String(value ?? "").trim();
}

function supabasePublicBase(): string {
  try {
    const env = (globalThis as { process?: { env?: Record<string, string> } })
      ?.process?.env;
    return String(env?.EXPO_PUBLIC_SUPABASE_URL ?? "")
      .trim()
      .replace(/\/$/, "");
  } catch {
    return "";
  }
}

/**
 * Normalize media URLs/paths for display.
 * - Absolute https URLs pass through (with legacy bucket-path repair).
 * - Object paths under drivers|clients|restaurants → public avatars URL.
 * Never invents a decorative stock image.
 */
export function resolveCustomerMediaUrl(value: unknown): string {
  const raw = trimStr(value);
  if (!raw) return "";

  // Legacy mis-resolve: /object/public/drivers/... → /object/public/avatars/drivers/...
  if (/^https?:\/\//i.test(raw)) {
    return raw.replace(
      /\/storage\/v1\/object\/public\/(?!avatars\/)(drivers|clients|restaurants)\//i,
      "/storage/v1/object/public/avatars/$1/",
    );
  }

  const base = supabasePublicBase();
  if (!base) return raw;

  if (/^(drivers|clients|restaurants)\//i.test(raw)) {
    return `${base}/storage/v1/object/public/avatars/${raw}`;
  }

  if (raw.includes("/")) {
    const slash = raw.indexOf("/");
    const bucket = raw.slice(0, slash);
    const objectPath = raw.slice(slash + 1);
    if (bucket && objectPath) {
      return `${base}/storage/v1/object/public/${bucket}/${objectPath}`;
    }
  }

  return `${base}/storage/v1/object/public/avatars/${raw}`;
}

function firstTrimmed(...values: unknown[]): string {
  for (const value of values) {
    const s = trimStr(value);
    if (s) return s;
  }
  return "";
}

export function readCustomerTrackingIdentification(
  ride: Record<string, unknown> | null,
): CustomerTrackingIdentification | null {
  if (!ride?.driver_id) return null;

  const nested =
    ride.identification && typeof ride.identification === "object"
      ? (ride.identification as Record<string, unknown>)
      : null;

  const plate = firstTrimmed(
    nested?.vehicle_plate,
    ride.vehicle_plate,
    ride.vehicle_plate_snapshot,
  );
  const label = firstTrimmed(nested?.vehicle_label, ride.vehicle_label);
  const make = firstTrimmed(
    nested?.vehicle_make,
    ride.vehicle_make,
    ride.vehicle_make_snapshot,
  );
  const model = firstTrimmed(
    nested?.vehicle_model,
    ride.vehicle_model,
    ride.vehicle_model_snapshot,
  );
  const color = firstTrimmed(
    nested?.vehicle_color,
    ride.vehicle_color,
    ride.vehicle_color_snapshot,
  );
  const yearRaw =
    nested?.vehicle_year ?? ride.vehicle_year ?? ride.vehicle_year_snapshot;
  const year = Number(yearRaw);
  const composedLabel = [make, model].filter(Boolean).join(" ");
  const ratingRaw = Number(nested?.driver_rating ?? ride.driver_rating);
  const tripsRaw = Number(
    nested?.driver_trips_count ?? ride.driver_trips_count,
  );

  return {
    driverName: firstTrimmed(
      nested?.driver_name,
      ride.driver_name,
      ride.driver_display_name,
    ),
    driverPhoto: resolveCustomerMediaUrl(
      firstTrimmed(
        nested?.driver_photo,
        ride.driver_photo,
        ride.driver_photo_url,
      ),
    ),
    driverRating:
      Number.isFinite(ratingRaw) && ratingRaw > 0 ? ratingRaw : null,
    driverTrips:
      Number.isFinite(tripsRaw) && tripsRaw > 0 ? Math.trunc(tripsRaw) : null,
    vehicleLabel:
      label ||
      (composedLabel
        ? color
          ? `${composedLabel} ${color.toLowerCase()}`
          : composedLabel
        : ""),
    vehiclePlate: plate,
    vehicleYear: Number.isFinite(year) && year > 0 ? year : null,
    vehiclePhoto: resolveCustomerMediaUrl(
      firstTrimmed(
        nested?.vehicle_photo,
        ride.vehicle_photo,
        ride.vehicle_photo_url_snapshot,
      ),
    ),
    vehicleMake: make,
    vehicleModel: model,
    vehicleColor: color,
  };
}

export function driverInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
}
