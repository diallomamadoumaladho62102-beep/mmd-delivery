import {
  isDriverSpeeding,
  maxSpeedRawToKmh,
  parseRouteSpeedLimitSegments,
  resolveRouteSpeedLimitAtMeters,
} from "./navigationSpeedLimit";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

assert(maxSpeedRawToKmh({ speed: 30, unit: "mph" }) === 48, "mph → km/h");
assert(maxSpeedRawToKmh({ speed: 50, unit: "km/h" }) === 50, "km/h");
assert(maxSpeedRawToKmh({ unknown: true }) === null, "unknown");
assert(maxSpeedRawToKmh({ none: true }) === null, "none");

const geometry: GeoJSON.Feature<GeoJSON.LineString> = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "LineString",
    coordinates: [
      [-73.9512, 40.6458],
      [-73.9510, 40.6460],
      [-73.9508, 40.6462],
    ],
  },
};

const segments = parseRouteSpeedLimitSegments(geometry, [
  { speed: 30, unit: "mph" },
  { speed: 25, unit: "mph" },
]);

assert(segments.length === 2, "two segments");
assert(segments[0]?.postedSpeed === 30, "posted 30 mph");
assert(segments[0]?.speedLimitKmh === 48, "48 km/h");

const atStart = resolveRouteSpeedLimitAtMeters(segments, 0);
assert(atStart.postedSpeed === 30, "limit at start");

assert(isDriverSpeeding(13.9, 48) === true, "speeding above limit");
assert(isDriverSpeeding(13.33, 48) === false, "at limit not speeding");
assert(isDriverSpeeding(13.2, 48) === false, "within limit");
assert(isDriverSpeeding(13.2, null) === false, "no limit");

console.log("navigationSpeedLimit.test: ok");
