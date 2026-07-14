/** Pure Place suggestion parsing (shared with API client). */

export type MapboxPlaceSuggestion = {
  id: string;
  name: string;
  fullAddress: string;
  latitude: number;
  longitude: number;
  placeType: string;
};

export function parseMapboxPlaceSuggestions(raw: unknown): MapboxPlaceSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const out: MapboxPlaceSuggestion[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const latitude = Number(row.latitude);
    const longitude = Number(row.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const fullAddress = String(row.fullAddress ?? "").trim();
    const name = String(row.name ?? fullAddress).trim();
    if (!fullAddress && !name) continue;
    out.push({
      id: String(row.id ?? `${longitude},${latitude}`),
      name: name || fullAddress,
      fullAddress: fullAddress || name,
      latitude,
      longitude,
      placeType: String(row.placeType ?? "place"),
    });
  }
  return out;
}
