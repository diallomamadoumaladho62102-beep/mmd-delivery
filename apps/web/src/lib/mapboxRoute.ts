const MAPBOX_DIRECTIONS_URL =
  "https://api.mapbox.com/directions/v5/mapbox/driving";

type LatLng = {
  lat: number;
  lng: number;
};

export async function getDistanceAndEta(
  pickup: LatLng,
  dropoff: LatLng
): Promise<{ distanceMiles: number; etaMinutes: number }> {
  const accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!accessToken) {
    throw new Error("NEXT_PUBLIC_MAPBOX_TOKEN manquant");
  }

  // Format : lng,lat;lng,lat (ordre important !)
  const coords = `${pickup.lng},${pickup.lat};${dropoff.lng},${dropoff.lat}`;

  const url = `${MAPBOX_DIRECTIONS_URL}/${coords}?alternatives=false&geometries=geojson&overview=simplified&access_token=${accessToken}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Mapbox error: ${res.status}`);
  }

  const json = await res.json();

  const route = json.routes?.[0];
  if (!route) {
    throw new Error("Aucun itinéraire trouvé par Mapbox");
  }

  const distanceMeters = route.distance as number; // en mètres
  const durationSeconds = route.duration as number; // en secondes

  const distanceMiles = Number((distanceMeters / 1609.34).toFixed(2));
  const etaMinutes = Math.round(durationSeconds / 60);

  return { distanceMiles, etaMinutes };
}
