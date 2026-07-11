import {
  computeSafetyAnnouncements,
  getRoadSafetyEvents,
  initSafetyVoiceState,
  projectPointOntoRoute,
  projectSafetyEventsOntoRoute,
  type ProjectedSafetyEvent,
  type RoadSafetyEvent,
} from "./roadSafety";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// Straight route heading east along the equator: [0,0] -> [0.01,0] -> [0.02,0].
const route: GeoJSON.Feature<GeoJSON.LineString> = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "LineString",
    coordinates: [
      [0, 0],
      [0.01, 0],
      [0.02, 0],
    ],
  },
};

// --- projectPointOntoRoute ---
const onLine = projectPointOntoRoute({ latitude: 0, longitude: 0.005 }, route);
assert(onLine != null, "projection exists");
assert(onLine!.lateralMeters < 1, "point on line has ~0 lateral");
assert(Math.abs(onLine!.alongRouteMeters - 556) < 5, "along ~556m at mid of first segment");

// --- projectSafetyEventsOntoRoute ---
const events: RoadSafetyEvent[] = [
  // Ahead on route
  { id: "ahead", type: "speed_camera", coordinate: { latitude: 0, longitude: 0.009 }, source: "test" },
  // Behind the driver
  { id: "behind", type: "speed_camera", coordinate: { latitude: 0, longitude: 0.001 }, source: "test" },
  // Parallel road (lateral offset ~111m)
  { id: "parallel", type: "speed_camera", coordinate: { latitude: 0.001, longitude: 0.009 }, source: "test" },
  // Opposite direction (facing west while route heads east)
  {
    id: "opposite",
    type: "speed_camera",
    coordinate: { latitude: 0, longitude: 0.012 },
    source: "test",
    direction: "forward",
    bearing: 270,
  },
];

const projected = projectSafetyEventsOntoRoute({
  events,
  geometry: route,
  traveledMeters: 300,
});
const ids = projected.map((e) => e.id);
assert(ids.includes("ahead"), "ahead event kept");
assert(!ids.includes("behind"), "behind event rejected");
assert(!ids.includes("parallel"), "parallel road event rejected");
assert(!ids.includes("opposite"), "opposite direction event rejected");

// --- 500/200 announcements with reset ---
function projectedEvent(id: string, distanceAhead: number): ProjectedSafetyEvent {
  return {
    id,
    type: "speed_camera",
    coordinate: { latitude: 0, longitude: 0 },
    source: "test",
    alongRouteMeters: distanceAhead,
    lateralMeters: 0,
    distanceAheadMeters: distanceAhead,
  };
}

let state = initSafetyVoiceState();
let out = computeSafetyAnnouncements({
  state,
  routeVersion: "r1",
  events: [projectedEvent("cam1", 540)],
  locale: "fr",
});
state = out.state;
assert(out.announcement?.bucket === "500", "safety 500 fires");
assert(out.announcement?.text.includes("radar de vitesse"), "safety label FR");

out = computeSafetyAnnouncements({
  state,
  routeVersion: "r1",
  events: [projectedEvent("cam1", 500)],
  locale: "fr",
});
state = out.state;
assert(out.announcement === null, "no repeat safety 500");

out = computeSafetyAnnouncements({
  state,
  routeVersion: "r1",
  events: [projectedEvent("cam1", 210)],
  locale: "fr",
});
state = out.state;
assert(out.announcement?.bucket === "200", "safety 200 fires");

// Reroute reset.
out = computeSafetyAnnouncements({
  state,
  routeVersion: "r2",
  events: [projectedEvent("cam1", 520)],
  locale: "fr",
});
assert(out.announcement?.bucket === "500", "safety re-announces after reroute");

// School zone slow-down suffix at 200.
const school = computeSafetyAnnouncements({
  state: initSafetyVoiceState(),
  routeVersion: "s1",
  events: [
    {
      id: "sch",
      type: "school_zone",
      coordinate: { latitude: 0, longitude: 0 },
      source: "test",
      alongRouteMeters: 190,
      lateralMeters: 0,
      distanceAheadMeters: 190,
    },
  ],
  locale: "fr",
});
assert(
  school.announcement?.text.includes("zone scolaire") &&
    school.announcement?.text.includes("ralentissez"),
  "school zone slow-down phrase",
);

// --- Honest data source: no provider → no fabricated events ---
async function main() {
  const none = await getRoadSafetyEvents({ routeGeometry: route, countryCode: "US" });
  assert(none.length === 0, "no provider → empty events (no fabrication)");
  console.log("roadSafety tests passed");
}

void main();
