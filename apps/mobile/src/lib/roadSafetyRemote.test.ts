import { fetchRoadSafetyEvents, parseRoadSafetyResponse } from "./roadSafetyRemote";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// --- parse normalizes + drops invalid rows ---
const parsed = parseRoadSafetyResponse({
  events: [
    {
      id: "e1",
      type: "speed_camera",
      latitude: 1.5,
      longitude: -2.5,
      source: "osm",
      source_ref: "node/1",
      confidence: 0.7,
      direction: "forward",
      bearing: 90,
      speed_limit_kmh: 50,
    },
    { type: "not_a_type", latitude: 1, longitude: 1 }, // invalid type → dropped
    { type: "stop_sign", latitude: "x", longitude: 1 }, // invalid coord → dropped
    { type: "school_zone", latitude: 3, longitude: 3, schedule: { activeNow: true } },
  ],
  config: { enable_speed_camera: true, min_confidence: 0.6 },
  attribution: "© OpenStreetMap contributors",
});

assert(parsed.events.length === 2, "invalid rows dropped");
const cam = parsed.events.find((e) => e.id === "e1");
assert(cam?.type === "speed_camera", "type mapped");
assert(cam?.coordinate.latitude === 1.5 && cam?.coordinate.longitude === -2.5, "coord mapped");
assert(cam?.speedLimitKmh === 50, "speed limit mapped");
assert(cam?.direction === "forward" && cam?.bearing === 90, "direction/bearing mapped");
const school = parsed.events.find((e) => e.type === "school_zone");
assert(school?.schedule?.activeNow === true, "schedule mapped when reliable");
assert(parsed.config.enableSpeedCamera === true, "config merged");
assert(parsed.config.minConfidence === 0.6, "config threshold merged");
assert(parsed.attribution.includes("OpenStreetMap"), "attribution preserved");

// --- empty / malformed payload is safe ---
const empty = parseRoadSafetyResponse(null);
assert(empty.events.length === 0, "null payload → no events");
assert(empty.attribution.includes("OpenStreetMap"), "default attribution");

// --- fetch wrapper: propagates parsed data + surfaces errors ---
async function main() {
  const okClient = {
    functions: {
      invoke: async () => ({
        data: { events: [], config: {}, attribution: "© OpenStreetMap contributors" },
        error: null,
      }),
    },
  };
  const res = await fetchRoadSafetyEvents(okClient, {
    bbox: { south: 0, west: 0, north: 1, east: 1 },
    countryCode: "US",
  });
  assert(res.events.length === 0, "ok fetch parsed");

  const errClient = {
    functions: {
      invoke: async () => ({ data: null, error: new Error("boom") }),
    },
  };
  let threw = false;
  try {
    await fetchRoadSafetyEvents(errClient, {
      bbox: { south: 0, west: 0, north: 1, east: 1 },
      countryCode: null,
    });
  } catch {
    threw = true;
  }
  assert(threw, "fetch error surfaced (hook falls back to cache)");

  console.log("roadSafetyRemote tests passed");
}

void main();
