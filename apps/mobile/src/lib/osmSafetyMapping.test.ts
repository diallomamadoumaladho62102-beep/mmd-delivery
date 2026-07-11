// Tests the shared OSM→event mapping used by the Supabase ingestion Edge
// Function. Imported by relative path so both Deno and this tsx harness share
// exactly one implementation (no duplicated mapping logic).
import {
  buildOverpassQuery,
  mapOsmElement,
  mapOsmElements,
  parseMaxSpeedKmh,
  type OsmElement,
} from "../../../../supabase/functions/_shared/osmSafetyMapping";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// --- maxspeed parsing (km/h + mph + junk) ---
assert(parseMaxSpeedKmh("50") === 50, "plain kmh");
assert(parseMaxSpeedKmh("30 mph") === 48, "mph → kmh");
assert(parseMaxSpeedKmh("none") === null, "none → null");
assert(parseMaxSpeedKmh(undefined) === null, "missing → null");

// --- speed camera ---
const cam = mapOsmElement({
  type: "node",
  id: 1,
  lat: 10,
  lon: 20,
  tags: { highway: "speed_camera", maxspeed: "50" },
});
assert(cam?.type === "speed_camera", "speed camera mapped");
assert(cam?.source === "osm" && cam?.source_ref === "node/1", "source ref for dedup");
assert(cam?.speed_limit_kmh === 50, "camera speed limit parsed");

// --- red-light camera (enforcement=traffic_signals) ---
const red = mapOsmElement({
  type: "node",
  id: 2,
  lat: 10,
  lon: 20,
  tags: { highway: "speed_camera", enforcement: "traffic_signals" },
});
assert(red?.type === "red_light_camera", "red-light distinguished from speed camera");

// --- stop sign ---
const stop = mapOsmElement({ type: "node", id: 3, lat: 1, lon: 1, tags: { highway: "stop" } });
assert(stop?.type === "stop_sign", "stop sign mapped");

// --- school zone (area with center) ---
const school = mapOsmElement({
  type: "way",
  id: 4,
  center: { lat: 5, lon: 6 },
  tags: { amenity: "school" },
});
assert(school?.type === "school_zone", "school zone mapped from area center");
assert(school?.schedule === null, "never asserts active hours when unknown");

// --- unrecognized element ignored (no fabrication) ---
const noise = mapOsmElement({ type: "node", id: 5, lat: 0, lon: 0, tags: { amenity: "cafe" } });
assert(noise === null, "irrelevant tag → null");

// --- batch de-dup by source_ref ---
const dup: OsmElement[] = [
  { type: "node", id: 9, lat: 1, lon: 1, tags: { highway: "stop" } },
  { type: "node", id: 9, lat: 1, lon: 1, tags: { highway: "stop" } },
];
assert(mapOsmElements(dup).length === 1, "batch de-duplicates by source_ref");

// --- Overpass query includes all safety selectors + bbox ---
const query = buildOverpassQuery({ south: 1, west: 2, north: 3, east: 4 });
assert(query.includes('node["highway"="speed_camera"]'), "query fetches cameras");
assert(query.includes('node["highway"="stop"]'), "query fetches stops");
assert(query.includes('["amenity"="school"]'), "query fetches schools");
assert(query.includes("1,2,3,4"), "bbox embedded");

console.log("osmSafetyMapping tests passed");
