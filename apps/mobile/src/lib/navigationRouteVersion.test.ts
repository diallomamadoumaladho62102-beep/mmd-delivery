import { buildStableRouteVersion, hashNavigationSignature } from "./navigationRouteVersion";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const steps = [
  {
    instruction: "Turn right onto Main St",
    maneuverType: "turn",
    maneuverModifier: "right",
    distanceMeters: 400,
  },
  {
    instruction: "Arrive at destination",
    maneuverType: "arrive",
    maneuverModifier: "right",
    distanceMeters: 100,
  },
];

const coordsA = [
  [-73.99, 40.75],
  [-73.98, 40.76],
  [-73.97, 40.77],
];
const coordsB = [
  [-73.99, 40.75],
  [-73.985, 40.755],
  [-73.98, 40.76],
  [-73.97, 40.77],
];

const v1 = buildStableRouteVersion({
  selectedRouteIndex: 0,
  steps,
  coordinates: coordsA,
});
const v2 = buildStableRouteVersion({
  selectedRouteIndex: 0,
  steps,
  coordinates: coordsB,
});
assert(v1 === v2, "coordinate count change must not change route version");

const v3 = buildStableRouteVersion({
  selectedRouteIndex: 0,
  steps: [
    ...steps,
    {
      instruction: "Continue",
      maneuverType: "continue",
      maneuverModifier: "straight",
      distanceMeters: 50,
    },
  ],
  coordinates: coordsA,
});
assert(v1 !== v3, "new maneuver must change route version");

assert(
  hashNavigationSignature("abc") === hashNavigationSignature("abc"),
  "hash is deterministic",
);

console.log("navigationRouteVersion.test.ts — PASS");
