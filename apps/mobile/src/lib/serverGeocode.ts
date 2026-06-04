import { getApiBaseUrl } from "../../lib/apiBase";

export type GeocodedAddress = {
  formattedAddress: string;
  latitude: number;
  longitude: number;
};

export async function geocodeAddressViaApi(address: string): Promise<GeocodedAddress> {
  const base = getApiBaseUrl().replace(/\/+$/, "");
  const res = await fetch(`${base}/api/mapbox/geocode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address }),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(json?.error ?? "Geocode failed");
  }

  return {
    formattedAddress: json.formattedAddress ?? address,
    latitude: Number(json.latitude),
    longitude: Number(json.longitude),
  };
}
