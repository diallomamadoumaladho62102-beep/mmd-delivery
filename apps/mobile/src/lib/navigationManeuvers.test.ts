import {
  buildManeuverList,
  formatManeuverVoice,
  selectActiveManeuver,
} from "./navigationManeuvers";
import type { NavigationRouteStep } from "./navigationService";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// depart(150) → turn right(80) → turn left(120) → arrive
const steps: NavigationRouteStep[] = [
  { instruction: "Head north", distanceMeters: 150, durationSeconds: 30, maneuverType: "depart" },
  {
    instruction: "Turn right onto First St",
    distanceMeters: 80,
    durationSeconds: 20,
    maneuverType: "turn",
    maneuverModifier: "right",
    roadName: "First St",
  },
  {
    instruction: "Turn left onto Second St",
    distanceMeters: 120,
    durationSeconds: 25,
    maneuverType: "turn",
    maneuverModifier: "left",
    roadName: "Second St",
  },
  { instruction: "Arrive at destination", distanceMeters: 0, durationSeconds: 0, maneuverType: "arrive" },
];

const maneuvers = buildManeuverList(steps, "v1");

// Cumulative along-route positions.
assert(maneuvers[0].alongRouteMeters === 0, "depart at 0");
assert(maneuvers[1].alongRouteMeters === 150, "first turn at 150");
assert(maneuvers[2].alongRouteMeters === 230, "second turn at 230");
assert(maneuvers[3].alongRouteMeters === 350, "arrive at 350");
assert(maneuvers[1].kind === "turn-right", "kind turn-right");
assert(maneuvers[2].kind === "turn-left", "kind turn-left");
assert(maneuvers[3].isArrival, "arrival flagged");

// Stable ids include the route version (reroute reset).
assert(maneuvers[1].id === "v1:1", "stable id");

// At start → next real maneuver is the first turn, never depart.
const atStart = selectActiveManeuver(maneuvers, 0);
assert(atStart?.active.kind === "turn-right", "active = first turn at start");
assert(atStart?.active.kind !== "depart" && atStart?.active.index !== 0, "never depart");
assert(atStart?.distanceMeters === 150, "distance to first turn");
assert(atStart?.secondary?.kind === "turn-left", "secondary = second turn");
assert(atStart?.secondaryDistanceMeters === 230, "secondary distance");

// Just after the first turn point (within tolerance) it stays active.
const justPast = selectActiveManeuver(maneuvers, 160);
assert(justPast?.active.index === 1, "first turn kept within tolerance");
assert(justPast?.distanceMeters === 0, "distance clamped to 0");

// Clearly past the first turn → switch to the second (close maneuver order).
const afterFirst = selectActiveManeuver(maneuvers, 185);
assert(afterFirst?.active.index === 2, "switched to second turn after passing first");
assert(afterFirst?.distanceMeters === 45, "distance to second turn");

// Never jumps to arrival while an intermediate maneuver remains.
const midRoute = selectActiveManeuver(maneuvers, 100);
assert(midRoute?.active.index === 1 && !midRoute?.active.isArrival, "no early arrival");

// Arrival becomes active only once both turns are behind.
const nearEnd = selectActiveManeuver(maneuvers, 300);
assert(nearEnd?.active.isArrival === true, "arrival active at end");

// --- Voice phrasing ---
const rightManeuver = maneuvers[1];

assert(
  formatManeuverVoice({ maneuver: rightManeuver, distanceMeters: 500, locale: "fr" }) ===
    "Dans 500 mètres, tournez à droite sur First St",
  "FR 500m right phrase",
);
assert(
  formatManeuverVoice({ maneuver: rightManeuver, distanceMeters: 200, locale: "fr" }) ===
    "Dans 200 mètres, tournez à droite sur First St",
  "FR 200m right phrase",
);
assert(
  formatManeuverVoice({ maneuver: rightManeuver, distanceMeters: null, locale: "fr" }) ===
    "Maintenant, tournez à droite sur First St",
  "FR immediate right phrase",
);
assert(
  formatManeuverVoice({ maneuver: maneuvers[2], distanceMeters: 500, locale: "en" }).includes(
    "turn left onto Second St",
  ),
  "EN left phrase includes street",
);

const roundabout = buildManeuverList(
  [
    { instruction: "Depart", distanceMeters: 100, durationSeconds: 10, maneuverType: "depart" },
    { instruction: "Enter roundabout", distanceMeters: 50, durationSeconds: 10, maneuverType: "roundabout" },
    { instruction: "Arrive", distanceMeters: 0, durationSeconds: 0, maneuverType: "arrive" },
  ],
  "v2",
);
assert(
  formatManeuverVoice({ maneuver: roundabout[1], distanceMeters: 500, locale: "fr" }) ===
    "Dans 500 mètres, prenez le rond-point",
  "FR roundabout phrase (no street)",
);

const exitList = buildManeuverList(
  [
    { instruction: "Depart", distanceMeters: 100, durationSeconds: 10, maneuverType: "depart" },
    { instruction: "Take exit", distanceMeters: 50, durationSeconds: 10, maneuverType: "off ramp", roadName: "A1" },
    { instruction: "Arrive", distanceMeters: 0, durationSeconds: 0, maneuverType: "arrive" },
  ],
  "v3",
);
assert(exitList[1].kind === "exit", "exit kind");
assert(
  formatManeuverVoice({ maneuver: exitList[1], distanceMeters: 200, locale: "fr" }).includes(
    "prenez la sortie",
  ),
  "FR exit phrase",
);

const uturnList = buildManeuverList(
  [
    { instruction: "Depart", distanceMeters: 100, durationSeconds: 10, maneuverType: "depart" },
    { instruction: "Make a U-turn", distanceMeters: 50, durationSeconds: 10, maneuverType: "turn", maneuverModifier: "uturn" },
    { instruction: "Arrive", distanceMeters: 0, durationSeconds: 0, maneuverType: "arrive" },
  ],
  "v4",
);
assert(uturnList[1].kind === "uturn", "uturn kind");
assert(
  formatManeuverVoice({ maneuver: uturnList[1], distanceMeters: null, locale: "fr" }) ===
    "Maintenant, faites demi-tour",
  "FR uturn immediate",
);

assert(
  formatManeuverVoice({ maneuver: maneuvers[3], distanceMeters: null, locale: "fr" }) ===
    "Vous êtes arrivé à destination",
  "FR arrival phrase",
);

console.log("navigationManeuvers tests passed");
