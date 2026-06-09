const MAPBOX_TOKEN =
  process.env.MAPBOX_ACCESS_TOKEN ?? process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

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

async function geocodeAddress(address: string) {
  if (!MAPBOX_TOKEN) throw new Error("Mapbox token missing");

  const url =
    "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
    encodeURIComponent(address) +
    `.json?access_token=${encodeURIComponent(MAPBOX_TOKEN)}&limit=1`;

  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Mapbox geocoding failed (${res.status})`);
  }

  const json = await res.json();
  const feature = json.features?.[0];
  if (!feature?.center) {
    throw new Error(`No geocoding result for: ${address}`);
  }

  const [lng, lat] = feature.center as [number, number];
  return { lat, lng };
}

async function getMultiLegDistanceAndDuration(
  coordinates: { lat: number; lng: number }[]
) {
  if (!MAPBOX_TOKEN) throw new Error("Mapbox token missing");
  if (coordinates.length < 2) {
    throw new Error("At least pickup and dropoff are required");
  }

  const coordPath = coordinates
    .map((point) => `${point.lng},${point.lat}`)
    .join(";");

  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/driving/${coordPath}`
  );
  url.searchParams.set("overview", "false");
  url.searchParams.set("access_token", MAPBOX_TOKEN);

  const res = await fetch(url.toString(), {
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Mapbox directions failed (${res.status})`);
  }

  const json = await res.json();
  const route = json.routes?.[0];
  if (!route) {
    throw new Error("No route found for multi-stop taxi ride");
  }

  const distanceMeters = Number(route.distance ?? 0);
  const durationSeconds = Number(route.duration ?? 0);

  return {
    distanceMiles: distanceMeters / 1609.34,
    durationMinutes: durationSeconds / 60,
  };
}

async function getDistanceAndDuration(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number
) {
  if (!MAPBOX_TOKEN) throw new Error("Mapbox token missing");

  const url = new URL(
    `https://api.mapbox.com/directions/v5/mapbox/driving/${pickupLng},${pickupLat};${dropoffLng},${dropoffLat}`
  );
  url.searchParams.set("overview", "false");
  url.searchParams.set("access_token", MAPBOX_TOKEN);

  const res = await fetch(url.toString(), {
    headers: { "Content-Type": "application/json" },
  });

  if (!res.ok) {
    throw new Error(`Mapbox directions failed (${res.status})`);
  }

  const json = await res.json();
  const route = json.routes?.[0];
  if (!route) {
    throw new Error("No route found between pickup and dropoff");
  }

  const distanceMeters = Number(route.distance ?? 0);
  const durationSeconds = Number(route.duration ?? 0);

  return {
    distanceMiles: distanceMeters / 1609.34,
    durationMinutes: durationSeconds / 60,
  };
}

export async function resolveTaxiRoute(input: TaxiRouteInput): Promise<TaxiRouteResult> {
  let pickupLat = input.pickupLat;
  let pickupLng = input.pickupLng;
  let dropoffLat = input.dropoffLat;
  let dropoffLng = input.dropoffLng;
  let pickupAddress = input.pickupAddress?.trim() || null;
  let dropoffAddress = input.dropoffAddress?.trim() || null;

  if (
    pickupLat != null &&
    pickupLng != null &&
    dropoffLat != null &&
    dropoffLng != null
  ) {
    // Prefer explicit coordinates (e.g. location_point pin snapshot).
  } else if (pickupAddress && dropoffAddress) {
    const pickupGeo = await geocodeAddress(pickupAddress);
    const dropoffGeo = await geocodeAddress(dropoffAddress);
    pickupLat = pickupGeo.lat;
    pickupLng = pickupGeo.lng;
    dropoffLat = dropoffGeo.lat;
    dropoffLng = dropoffGeo.lng;
  } else {
    throw new Error(
      "Missing pickup/dropoff coordinates or addresses"
    );
  }

  const { distanceMiles, durationMinutes } = await getDistanceAndDuration(
    pickupLat!,
    pickupLng!,
    dropoffLat!,
    dropoffLng!
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
  if (input.lat != null && input.lng != null) {
    return {
      address: input.address?.trim() || fallbackLabel,
      lat: input.lat,
      lng: input.lng,
    };
  }

  const address = input.address?.trim();
  if (!address) {
    throw new Error(`Missing ${fallbackLabel} coordinates or address`);
  }

  const geo = await geocodeAddress(address);
  return { address, lat: geo.lat, lng: geo.lng };
}

export async function resolveTaxiMultiStopRoute(
  input: TaxiMultiStopRouteInput
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
