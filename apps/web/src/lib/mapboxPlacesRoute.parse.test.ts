import assert from "node:assert/strict";

/** Mirrors places route suggestion parsing for regression without Next runtime. */
function parseSuggestions(data: unknown): Array<{
  id: string;
  name: string;
  fullAddress: string;
  latitude: number;
  longitude: number;
  placeType: string;
}> {
  const features = (data as { features?: unknown[] } | null)?.features;
  if (!Array.isArray(features)) return [];

  const out: Array<{
    id: string;
    name: string;
    fullAddress: string;
    latitude: number;
    longitude: number;
    placeType: string;
  }> = [];
  for (const feature of features) {
    const row = feature as {
      id?: string;
      text?: string;
      place_name?: string;
      center?: number[];
      place_type?: string[];
    };
    const [lng, lat] = row.center ?? [];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({
      id: String(row.id ?? `${lng},${lat}`),
      name: String(row.text ?? row.place_name ?? "").trim() || String(row.place_name ?? ""),
      fullAddress: String(row.place_name ?? "").trim(),
      latitude: Number(lat),
      longitude: Number(lng),
      placeType: String(row.place_type?.[0] ?? "place"),
    });
  }
  return out;
}

function testEmptyFeatures() {
  assert.deepEqual(parseSuggestions({ features: [] }), []);
  assert.deepEqual(parseSuggestions(null), []);
}

function testFeatureParse() {
  const suggestions = parseSuggestions({
    features: [
      {
        id: "address.1",
        text: "Main",
        place_name: "Main St, NYC",
        center: [-73.9, 40.7],
        place_type: ["address"],
      },
    ],
  });
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].latitude, 40.7);
  assert.equal(suggestions[0].longitude, -73.9);
  assert.equal(suggestions[0].placeType, "address");
}

testEmptyFeatures();
testFeatureParse();

console.log("mapboxPlacesRoute.parse.test.ts OK");
