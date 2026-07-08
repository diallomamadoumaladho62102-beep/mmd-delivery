const MAPBOX_TOKEN =
  process.env.MAPBOX_ACCESS_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

const EARTH_RADIUS_MILES = 3958.8;
export const ROUTE_UNAVAILABLE = "route_unavailable";

export type TaxiRouteInput = {
  pickupAddress?: string;
  dropoffAddress?: string;
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
};

export type TaxiStopInput = {
  address?: string;
  lat?: number;
  lng?: number;
};

export type TaxiMultiStopRouteInput = TaxiRouteInput & {
  stops?: TaxiStopInput[];
};

export type TaxiStopResult = {
  stopOrder: number;
  address: string;
  lat: number;
  lng: number;
};

export type TaxiMultiStopRouteResult = TaxiRouteResult & {
  stops: TaxiStopResult[];
};

export type TaxiRouteResult = {
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  pickupAddress: string | null;
  dropoffAddress: string | null;
  distanceMiles: number;
  durationMinutes: number;
};

export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  if (latitude < -90 || latitude > 90) return false;
  if (longitude < -180 || longitude > 180) return false;
  if (Math.abs(latitude) < 0.000001 && Math.abs(longitude) < 0.000001) return false;
  return true;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function estimateHaversineRoute(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
) {
  const dLat = toRadians(dropoffLat - pickupLat);
  const dLng = toRadians(dropoffLng - pickupLng);
  const lat1 = toRadians(pickupLat);
  const lat2 = toRadians(dropoffLat);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  const distanceMiles = EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const durationMinutes = Math.max(5, (distanceMiles / 25) * 60);

  return { distanceMiles, durationMinutes, fallback: true as const };
}

function buildCoordinatePath(coordinates: Array<{ lat: number; lng: number }>) {
  if (coordinates.length < 2) {
    throw new Error(ROUTE_UNAVAILABLE);
  }

  for (const point of coordinates) {
    if (!isValidCoordinate(point.lat, point.lng)) {
      throw new Error(ROUTE_UNAVAILABLE);
    }
  }

  return coordinates.map((point) => `${point.lng},${point.lat}`).join(";");
}

async function geocodeAddress(address: string) {
  if (!MAPBOX_TOKEN) throw new Error(ROUTE_UNAVAILABLE);

  const trimmed = String(address ?? "").trim();
  if (trimmed.length < 3) throw new Error(ROUTE_UNAVAILABLE);

  const url =
    "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
    encodeURIComponent(trimmed) +
    `.json?access_token=${encodeURIComponent(MAPBOX_TOKEN)}&limit=1`;

  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    console.error("[taxiMapbox] geocoding failed", { status: res.status, address: trimmed });
    throw new Error(ROUTE_UNAVAILABLE);
  }

  const json = await res.json();
  const feature = json.features?.[0];
  if (!feature?.center) {
    console.error("[taxiMapbox] geocoding empty result", { address: trimmed });
    throw new Error(ROUTE_UNAVAILABLE);
  }

  const [lng, lat] = feature.center as [number, number];
  if (!isValidCoordinate(lat, lng)) throw new Error(ROUTE_UNAVAILABLE);

  return { lat, lng };
}

async function getMultiLegDistanceAndDuration(
  coordinates: { lat: number; lng: number }[],
) {
  if (!MAPBOX_TOKEN) throw new Error(ROUTE_UNAVAILABLE);
  if (coordinates.length < 2) throw new Error(ROUTE_UNAVAILABLE);

  const coordPath = buildCoordinatePath(coordinates);
  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/driving/${coordPath}`,
  );
  url.searchParams.set("overview", "false");
  url.searchParams.set("access_token", MAPBOX_TOKEN);

  const res = await fetch(url.toString(), {
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    console.error("[taxiMapbox] directions failed", {
      status: res.status,
      coordinates: coordinates.length,
    });
    return estimateHaversineRoute(
      coordinates[0].lat,
      coordinates[0].lng,
      coordinates[coordinates.length - 1].lat,
      coordinates[coordinates.length - 1].lng,
    );
  }

  const json = await res.json();
  const route = json.routes?.[0];
  if (!route) {
    console.error("[taxiMapbox] directions empty route", { coordinates: coordinates.length });
    return estimateHaversineRoute(
      coordinates[0].lat,
      coordinates[0].lng,
      coordinates[coordinates.length - 1].lat,
      coordinates[coordinates.length - 1].lng,
    );
  }

  const distanceMeters = Number(route.distance ?? 0);
  const durationSeconds = Number(route.duration ?? 0);

  return {
    distanceMiles: distanceMeters / 1609.34,
    durationMinutes: durationSeconds / 60,
    fallback: false as const,
  };
}

async function getDistanceAndDuration(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
) {
  return getMultiLegDistanceAndDuration([
    { lat: pickupLat, lng: pickupLng },
    { lat: dropoffLat, lng: dropoffLng },
  ]);
}

export async function resolveTaxiRoute(input: TaxiRouteInput): Promise<TaxiRouteResult> {
  let pickupLat = input.pickupLat;
  let pickupLng = input.pickupLng;
  let dropoffLat = input.dropoffLat;
  let dropoffLng = input.dropoffLng;
  let pickupAddress = input.pickupAddress?.trim() || null;
  let dropoffAddress = input.dropoffAddress?.trim() || null;

  if (isValidCoordinate(pickupLat, pickupLng) && isValidCoordinate(dropoffLat, dropoffLng)) {
    // Prefer explicit coordinates.
  } else if (pickupAddress && dropoffAddress) {
    const pickupGeo = await geocodeAddress(pickupAddress);
    const dropoffGeo = await geocodeAddress(dropoffAddress);
    pickupLat = pickupGeo.lat;
    pickupLng = pickupGeo.lng;
    dropoffLat = dropoffGeo.lat;
    dropoffLng = dropoffGeo.lng;
  } else {
    throw new Error(ROUTE_UNAVAILABLE);
  }

  const { distanceMiles, durationMinutes } = await getDistanceAndDuration(
    pickupLat!,
    pickupLng!,
    dropoffLat!,
    dropoffLng!,
  );

  const BLOCK_MILES = 50;
  if (distanceMiles > BLOCK_MILES) {
    throw new Error("distance_too_far");
  }

  return {
    pickupLat: pickupLat!,
    pickupLng: pickupLng!,
    dropoffLat: dropoffLat!,
    dropoffLng: dropoffLng!,
    pickupAddress,
    dropoffAddress,
    distanceMiles,
    durationMinutes,
  };
}

async function resolveStop(input: TaxiStopInput, fallbackLabel: string) {
  if (isValidCoordinate(input.lat, input.lng)) {
    return {
      address: input.address?.trim() || fallbackLabel,
      lat: Number(input.lat),
      lng: Number(input.lng),
    };
  }

  const address = input.address?.trim();
  if (!address) {
    throw new Error(ROUTE_UNAVAILABLE);
  }

  const geo = await geocodeAddress(address);
  return { address, lat: geo.lat, lng: geo.lng };
}

export async function resolveTaxiMultiStopRoute(
  input: TaxiMultiStopRouteInput,
): Promise<TaxiMultiStopRouteResult> {
  const baseRoute = await resolveTaxiRoute(input);
  const rawStops = Array.isArray(input.stops) ? input.stops.slice(0, 3) : [];

  const stops: TaxiStopResult[] = [];
  for (let i = 0; i < rawStops.length; i += 1) {
    const resolved = await resolveStop(rawStops[i], `Stop ${i + 1}`);
    stops.push({
      stopOrder: i + 1,
      address: resolved.address,
      lat: resolved.lat,
      lng: resolved.lng,
    });
  }

  const coordinates = [
    { lat: baseRoute.pickupLat, lng: baseRoute.pickupLng },
    ...stops.map((stop) => ({ lat: stop.lat, lng: stop.lng })),
    { lat: baseRoute.dropoffLat, lng: baseRoute.dropoffLng },
  ];

  const { distanceMiles, durationMinutes } =
    await getMultiLegDistanceAndDuration(coordinates);

  const BLOCK_MILES = 50;
  if (distanceMiles > BLOCK_MILES) {
    throw new Error("distance_too_far");
  }

  return {
    ...baseRoute,
    distanceMiles,
    durationMinutes,
    stops,
  };
}
