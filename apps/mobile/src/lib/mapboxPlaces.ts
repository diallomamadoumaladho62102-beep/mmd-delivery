import { getApiBaseUrl } from "./apiBase";
import { getMapboxAuthHeaders } from "./mapboxComputeDistance";
import {
  parseMapboxPlaceSuggestions,
  type MapboxPlaceSuggestion,
} from "./mapboxPlacesParse";

export type { MapboxPlaceSuggestion };
export { parseMapboxPlaceSuggestions };

export type SearchMapboxPlacesParams = {
  query: string;
  proximity?: { lat: number; lng: number };
  country?: string;
  limit?: number;
  signal?: AbortSignal;
};

/**
 * Empty / short queries return [] without hitting the network.
 */
export async function searchMapboxPlaces(
  params: SearchMapboxPlacesParams
): Promise<MapboxPlaceSuggestion[]> {
  const query = String(params.query ?? "").trim();
  if (!query || query.length < 3) {
    return [];
  }

  const base = getApiBaseUrl().replace(/\/+$/, "");
  const headers = await getMapboxAuthHeaders();
  const limit = Math.min(10, Math.max(1, Number(params.limit) || 5));

  const res = await fetch(`${base}/api/mapbox/places`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      query,
      proximity: params.proximity,
      country: params.country,
      limit,
    }),
    signal: params.signal,
  });

  const json = (await res.json().catch(() => null)) as {
    ok?: boolean;
    suggestions?: unknown;
    error?: string;
  } | null;

  if (!res.ok || !json?.ok) {
    throw new Error(json?.error ?? "Places search failed");
  }

  return parseMapboxPlaceSuggestions(json.suggestions);
}
