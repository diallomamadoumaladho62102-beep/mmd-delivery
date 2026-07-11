import {
  bboxForRoute,
  isCacheFresh,
  mergeSafetyEvents,
  safetyCacheKey,
} from "./roadSafetyCache";
import type { RoadSafetyEvent } from "./roadSafety";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const route: GeoJSON.Feature<GeoJSON.LineString> = {
  type: "Feature",
  properties: {},
  geometry: { type: "LineString", coordinates: [[0, 0], [0.01, 0.01], [0.02, 0.02]] },
};

// --- bboxForRoute padded around extremes ---
const bbox = bboxForRoute(route);
assert(bbox != null, "bbox computed");
assert(bbox!.south < 0 && bbox!.north > 0.02, "lat padded beyond extremes");
assert(bbox!.west < 0 && bbox!.east > 0.02, "lng padded beyond extremes");
assert(bboxForRoute(null) === null, "no geometry → null bbox");

// --- stable cache key rounds bbox ---
const key = safetyCacheKey(bbox!, "US");
assert(key.startsWith("mmd.road_safety.events.v1:US:"), "key namespaced by country");
assert(safetyCacheKey(bbox!, null).includes(":XX:"), "null country → XX");

// --- cache freshness / expiry ---
const now = 1_000_000;
assert(isCacheFresh({ fetchedAt: now - 1000 }, 5000, now) === true, "fresh within ttl");
assert(isCacheFresh({ fetchedAt: now - 6000 }, 5000, now) === false, "expired past ttl");
assert(isCacheFresh(null, 5000, now) === false, "null payload not fresh");

// --- de-duplicated merge (higher confidence wins) ---
const a: RoadSafetyEvent = {
  id: "dup",
  type: "speed_camera",
  coordinate: { latitude: 1, longitude: 1 },
  source: "osm",
  confidence: 0.4,
};
const b: RoadSafetyEvent = { ...a, source: "manual", confidence: 0.9 };
const c: RoadSafetyEvent = {
  id: "other",
  type: "stop_sign",
  coordinate: { latitude: 2, longitude: 2 },
  source: "osm",
  confidence: 0.6,
};
const merged = mergeSafetyEvents([a], [b, c]);
assert(merged.length === 2, "duplicate collapsed, distinct kept");
const dup = merged.find((e) => e.id === "dup");
assert(dup?.source === "manual" && dup?.confidence === 0.9, "higher-confidence source wins");

console.log("roadSafetyCache tests passed");
