// apps/web/src/lib/mapboxDistance.ts

export type MapboxDistanceResult = {
  distance_miles_est: number | null;
  eta_minutes_est: number | null;
};

/**
 * Appelle ton endpoint interne /api/mapbox/compute-distance
 * et renvoie distance + temps estimé.
 */
export async function computeDistanceFromMapbox(params: {
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
}): Promise<MapboxDistanceResult> {
  const res = await fetch("/api/mapbox/compute-distance", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    console.error("Erreur HTTP Mapbox:", res.status);
    return { distance_miles_est: null, eta_minutes_est: null };
  }

  const json = await res.json();

  return {
    distance_miles_est:
      typeof json.distance_miles_est === "number"
        ? json.distance_miles_est
        : null,
    eta_minutes_est:
      typeof json.eta_minutes_est === "number"
        ? json.eta_minutes_est
        : null,
  };
}
