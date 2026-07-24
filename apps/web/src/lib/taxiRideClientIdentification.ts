/**
 * Client-facing taxi driver + vehicle identification.
 * Personal data only after official driver assignment (driver_id set).
 * Prefer ride snapshots frozen at accept; fall back to live joins for legacy rides.
 */

export type TaxiRideIdentification = {
  driver_name: string | null;
  driver_photo: string | null;
  driver_rating: number | null;
  driver_trips_count: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: number | null;
  vehicle_color: string | null;
  vehicle_plate: string | null;
  vehicle_photo: string | null;
  vehicle_label: string | null;
};

const EMPTY_IDENTIFICATION: TaxiRideIdentification = {
  driver_name: null,
  driver_photo: null,
  driver_rating: null,
  driver_trips_count: null,
  vehicle_make: null,
  vehicle_model: null,
  vehicle_year: null,
  vehicle_color: null,
  vehicle_plate: null,
  vehicle_photo: null,
  vehicle_label: null,
};

function trimOrNull(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s.length > 0 ? s : null;
}

function resolvePublicMediaUrl(value: unknown): string | null {
  const raw = trimOrNull(value);
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;

  const base = String(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "")
    .trim()
    .replace(/\/$/, "");
  if (!base) return raw;

  // Avatar / vehicle object paths are stored without the bucket prefix
  // (e.g. drivers/{uid}/avatar.jpg or drivers/{uid}/vehicles/{id}/primary.jpg).
  if (/^(drivers|clients|restaurants)\//i.test(raw)) {
    return `${base}/storage/v1/object/public/avatars/${raw}`;
  }

  // Explicit "<bucket>/<object>" paths.
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

function toRating(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function toTrips(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

function toYear(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1980 || n > 2100) return null;
  return n;
}

/** e.g. "Honda Accord Sport gris" */
export function formatTaxiVehicleLabel(input: {
  make?: string | null;
  model?: string | null;
  color?: string | null;
}): string | null {
  const make = trimOrNull(input.make);
  const model = trimOrNull(input.model);
  const color = trimOrNull(input.color);
  const parts = [make, model].filter(Boolean);
  if (parts.length === 0) return color;
  const base = parts.join(" ");
  return color ? `${base} ${color.toLowerCase()}` : base;
}

export function identificationFromSnapshot(
  ride: Record<string, unknown>,
): TaxiRideIdentification | null {
  if (!trimOrNull(ride.driver_id)) return null;

  const make = trimOrNull(ride.vehicle_make_snapshot);
  const model = trimOrNull(ride.vehicle_model_snapshot);
  const color = trimOrNull(ride.vehicle_color_snapshot);
  const plate = trimOrNull(ride.vehicle_plate_snapshot);
  const name = trimOrNull(ride.driver_display_name);

  // Treat as snapshot-ready when plate or name was frozen at accept.
  if (!plate && !name && !make) return null;

  return {
    driver_name: name,
    driver_photo: resolvePublicMediaUrl(ride.driver_photo_url),
    driver_rating: toRating(ride.driver_rating_snapshot),
    driver_trips_count: toTrips(ride.driver_trips_count_snapshot),
    vehicle_make: make,
    vehicle_model: model,
    vehicle_year: toYear(ride.vehicle_year_snapshot),
    vehicle_color: color,
    vehicle_plate: plate,
    vehicle_photo: resolvePublicMediaUrl(ride.vehicle_photo_url_snapshot),
    vehicle_label: formatTaxiVehicleLabel({ make, model, color }),
  };
}

export function identificationFromLiveSources(params: {
  driverId: string | null | undefined;
  profile?: {
    full_name?: string | null;
    avatar_url?: string | null;
  } | null;
  driverProfile?: {
    full_name?: string | null;
    photo_url?: string | null;
    rating?: number | null;
    rating_count?: number | null;
    total_deliveries?: number | null;
  } | null;
  taxiFeatures?: {
    rating_taxi?: number | null;
  } | null;
  vehicle?: {
    id?: string | null;
    vehicle_make?: string | null;
    vehicle_model?: string | null;
    vehicle_year?: number | null;
    vehicle_color?: string | null;
    license_plate?: string | null;
    vehicle_type?: string | null;
    photo_url?: string | null;
    deleted_at?: string | null;
  } | null;
  assignedVehicleId?: string | null;
}): TaxiRideIdentification | null {
  if (!trimOrNull(params.driverId)) return null;

  const vehicle = params.vehicle;
  if (vehicle?.deleted_at) return null;

  // Never surface a bike / wrong vehicle for a taxi assignment.
  const vehicleType = String(vehicle?.vehicle_type ?? "").toLowerCase();
  if (vehicleType === "bike" || vehicleType === "velo" || vehicleType === "vélo") {
    return null;
  }

  if (
    params.assignedVehicleId &&
    vehicle?.id &&
    String(vehicle.id) !== String(params.assignedVehicleId)
  ) {
    return null;
  }

  const make = trimOrNull(vehicle?.vehicle_make);
  const model = trimOrNull(vehicle?.vehicle_model);
  const color = trimOrNull(vehicle?.vehicle_color);
  const plate = trimOrNull(vehicle?.license_plate);

  return {
    driver_name:
      trimOrNull(params.profile?.full_name) ||
      trimOrNull(params.driverProfile?.full_name) ||
      "Chauffeur",
    driver_photo: resolvePublicMediaUrl(
      trimOrNull(params.driverProfile?.photo_url) ||
        trimOrNull(params.profile?.avatar_url),
    ),
    driver_rating:
      toRating(params.driverProfile?.rating) ??
      toRating(params.taxiFeatures?.rating_taxi),
    driver_trips_count:
      toTrips(params.driverProfile?.total_deliveries) ??
      toTrips(params.driverProfile?.rating_count),
    vehicle_make: make,
    vehicle_model: model,
    vehicle_year: toYear(vehicle?.vehicle_year),
    vehicle_color: color,
    vehicle_plate: plate,
    vehicle_photo: resolvePublicMediaUrl(vehicle?.photo_url),
    vehicle_label: formatTaxiVehicleLabel({ make, model, color }),
  };
}

export function applyIdentificationToRide(
  ride: Record<string, unknown>,
  identification: TaxiRideIdentification | null,
): Record<string, unknown> {
  const base = { ...ride };

  // Never leak private docs / VIN-style fields if present on joins.
  delete base.vin;
  delete base.vehicle_vin;
  delete base.insurance_document_url;
  delete base.registration_document_url;
  delete base.license_number;
  delete base.phone;
  delete base.driver_phone;

  if (!trimOrNull(ride.driver_id) || !identification) {
    return {
      ...base,
      ...EMPTY_IDENTIFICATION,
      identification: null,
    };
  }

  return {
    ...base,
    driver_name: identification.driver_name,
    driver_photo: identification.driver_photo,
    driver_rating: identification.driver_rating,
    driver_trips_count: identification.driver_trips_count,
    vehicle_make: identification.vehicle_make,
    vehicle_model: identification.vehicle_model,
    vehicle_year: identification.vehicle_year,
    vehicle_color: identification.vehicle_color,
    vehicle_plate: identification.vehicle_plate,
    vehicle_photo: identification.vehicle_photo,
    vehicle_label: identification.vehicle_label,
    identification,
  };
}

type AdminClient = {
  from: (table: string) => {
    select: (cols: string) => {
      eq: (
        col: string,
        val: string,
      ) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
        is?: (
          col: string,
          val: null,
        ) => {
          maybeSingle: () => Promise<{
            data: Record<string, unknown> | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };
};

/**
 * Enrich a taxi_rides row for client/API consumers.
 */
export async function enrichTaxiRideIdentification(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  ride: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const driverId = trimOrNull(ride.driver_id);
  if (!driverId) {
    return applyIdentificationToRide(ride, null);
  }

  const fromSnapshot = identificationFromSnapshot(ride);
  if (fromSnapshot) {
    return applyIdentificationToRide(ride, fromSnapshot);
  }

  const assignedVehicleId = trimOrNull(ride.assigned_vehicle_id);

  const [profileRes, driverProfileRes, taxiFeaturesRes, vehicleRes] =
    await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("full_name,avatar_url")
        .eq("id", driverId)
        .maybeSingle(),
      supabaseAdmin
        .from("driver_profiles")
        .select("full_name,photo_url,rating,rating_count,total_deliveries")
        .eq("user_id", driverId)
        .maybeSingle(),
      supabaseAdmin
        .from("taxi_driver_features")
        .select("rating_taxi")
        .eq("user_id", driverId)
        .maybeSingle(),
      assignedVehicleId
        ? supabaseAdmin
            .from("driver_vehicles")
            .select(
              "id,vehicle_make,vehicle_model,vehicle_year,vehicle_color,license_plate,vehicle_type,photo_url,deleted_at",
            )
            .eq("id", assignedVehicleId)
            .is("deleted_at", null)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

  const live = identificationFromLiveSources({
    driverId,
    profile: profileRes?.data ?? null,
    driverProfile: driverProfileRes?.data ?? null,
    taxiFeatures: taxiFeaturesRes?.data ?? null,
    vehicle: vehicleRes?.data ?? null,
    assignedVehicleId,
  });

  return applyIdentificationToRide(ride, live);
}

export async function enrichTaxiRidesIdentification(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabaseAdmin: any,
  rides: Record<string, unknown>[],
): Promise<Record<string, unknown>[]> {
  return Promise.all(
    rides.map((ride) => enrichTaxiRideIdentification(supabaseAdmin, ride)),
  );
}
