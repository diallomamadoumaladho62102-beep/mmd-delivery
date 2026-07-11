import {
  computeSafetyAnnouncements,
  initSafetyVoiceState,
  projectSafetyEventsOntoRoute,
  type ProjectedSafetyEvent,
  type RoadSafetyEvent,
} from "./roadSafety";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const route: GeoJSON.Feature<GeoJSON.LineString> = {
  type: "Feature",
  properties: {},
  geometry: { type: "LineString", coordinates: [[0, 0], [0.01, 0], [0.02, 0]] },
};

// --- configurable corridor radius tightens/loosens lateral acceptance ---
const nearRoad: RoadSafetyEvent[] = [
  { id: "e", type: "stop_sign", coordinate: { latitude: 0.0002, longitude: 0.009 }, source: "osm", confidence: 0.7 },
];
const tight = projectSafetyEventsOntoRoute({
  events: nearRoad,
  geometry: route,
  traveledMeters: 300,
  maxLateralMeters: 10, // ~22m lateral > 10 → rejected
});
assert(tight.length === 0, "tight corridor rejects side event");
const loose = projectSafetyEventsOntoRoute({
  events: nearRoad,
  geometry: route,
  traveledMeters: 300,
  maxLateralMeters: 40,
});
assert(loose.length === 1, "loose corridor accepts on-route event");

// --- configurable announce thresholds (far/near) ---
function ev(distance: number): ProjectedSafetyEvent {
  return {
    id: "cam",
    type: "speed_camera",
    coordinate: { latitude: 0, longitude: 0 },
    source: "osm",
    confidence: 0.7,
    alongRouteMeters: distance,
    lateralMeters: 0,
    distanceAheadMeters: distance,
  };
}

let state = initSafetyVoiceState();
// With far=300, an event at 500m must NOT announce yet.
let out = computeSafetyAnnouncements({
  state,
  routeVersion: "r1",
  events: [ev(500)],
  locale: "fr",
  thresholds: { far: 300, near: 150 },
});
state = out.state;
assert(out.announcement === null, "custom far=300 → silent at 500m");

// At 320m it enters the far band (300 * 1.1 = 330).
out = computeSafetyAnnouncements({
  state,
  routeVersion: "r1",
  events: [ev(320)],
  locale: "fr",
  thresholds: { far: 300, near: 150 },
});
state = out.state;
assert(out.announcement?.bucket === "500", "custom far band fires ~330m");

// --- reroute recomputes (new routeVersion re-announces) ---
out = computeSafetyAnnouncements({
  state,
  routeVersion: "r2",
  events: [ev(320)],
  locale: "fr",
  thresholds: { far: 300, near: 150 },
});
assert(out.announcement?.bucket === "500", "reroute re-announces on new route");

console.log("roadSafetySync tests passed");
