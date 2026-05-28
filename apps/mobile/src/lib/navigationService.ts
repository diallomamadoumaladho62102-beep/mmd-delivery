import Mapbox from "@rnmapbox/maps";

export type RoutePoint = {
  latitude: number;
  longitude: number;
};

export type NavigationRoute = {
  distanceMeters: number;
  durationSeconds: number;
  etaMinutes: number;
  geometry: GeoJSON.Feature<GeoJSON.LineString>;
};

const MAPBOX_TOKEN =
  process.env.EXPO_PUBLIC_MAPBOX_TOKEN ||
  process.env.MAPBOX_TOKEN ||
  "";

const DIRECTIONS_BASE =
  "https://api.mapbox.com/directions/v5/mapbox/driving";

function validateCoords(point: RoutePoint) {
  return (
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude)
  );
}

function buildCoords(points: RoutePoint[]) {
  return points
    .map((p) => `${p.longitude},${p.latitude}`)
    .join(";");
}

export async function fetchNavigationRoute(
  origin: RoutePoint,
  destination: RoutePoint,
  waypoints: RoutePoint[] = [],
): Promise<NavigationRoute | null> {
  try {
    if (!validateCoords(origin)) return null;
    if (!validateCoords(destination)) return null;

    const coords = buildCoords([
      origin,
      ...waypoints,
      destination,
    ]);

    const url =
      `${DIRECTIONS_BASE}/${coords}` +
      `?alternatives=false` +
      `&continue_straight=true` +
      `&geometries=geojson` +
      `&overview=full` +
      `&steps=true` +
      `&access_token=${MAPBOX_TOKEN}`;

    const response = await fetch(url);

    if (!response.ok) {
      console.log("Mapbox directions error:", response.status);
      return null;
    }

    const json = await response.json();

    const route = json?.routes?.[0];

    if (!route) {
      return null;
    }

    const geometry: GeoJSON.Feature<GeoJSON.LineString> = {
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: route.geometry.coordinates,
      },
    };

    const durationSeconds = Math.round(route.duration || 0);
    const distanceMeters = Math.round(route.distance || 0);

    return {
      geometry,
      durationSeconds,
      distanceMeters,
      etaMinutes: Math.max(
        1,
        Math.round(durationSeconds / 60),
      ),
    };
  } catch (e) {
    console.log("fetchNavigationRoute error:", e);
    return null;
  }
}

export async function fitCameraToRoute(
  cameraRef: React.RefObject<Mapbox.Camera>,
  route:
    | GeoJSON.Feature<GeoJSON.LineString>
    | null
    | undefined,
) {
  try {
    if (!cameraRef.current || !route) {
      return;
    }

    const coords = route.geometry.coordinates;

    if (!coords?.length) {
      return;
    }

    const ne = [
      Math.max(...coords.map((c) => c[0])),
      Math.max(...coords.map((c) => c[1])),
    ];

    const sw = [
      Math.min(...coords.map((c) => c[0])),
      Math.min(...coords.map((c) => c[1])),
    ];

    cameraRef.current.fitBounds(
      ne as [number, number],
      sw as [number, number],
      80,
      1200,
    );
  } catch (e) {
    console.log("fitCameraToRoute error:", e);
  }
}

export function calculateHeading(
  from: RoutePoint,
  to: RoutePoint,
) {
  const dLon =
    (to.longitude - from.longitude) *
    (Math.PI / 180);

  const lat1 = from.latitude * (Math.PI / 180);
  const lat2 = to.latitude * (Math.PI / 180);

  const y = Math.sin(dLon) * Math.cos(lat2);

  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) *
      Math.cos(lat2) *
      Math.cos(dLon);

  const brng = Math.atan2(y, x);

  return ((brng * 180) / Math.PI + 360) % 360;
}