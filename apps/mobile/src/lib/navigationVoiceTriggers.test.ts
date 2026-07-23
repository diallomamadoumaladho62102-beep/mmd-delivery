import type {
  ActiveManeuverSelection,
  RouteManeuver,
} from "./navigationManeuvers";
import {
  evaluateManeuverVoice,
  initVoiceTriggerState,
  resolveVoicePriority,
  VoicePriority,
  type VoiceAnnouncement,
} from "./navigationVoiceTriggers";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function maneuver(id: string, isArrival = false): RouteManeuver {
  return {
    id,
    index: 1,
    alongRouteMeters: 1000,
    kind: isArrival ? "arrive" : "turn-right",
    rawInstruction: isArrival ? "Arrive" : "Turn right onto Main St",
    streetName: isArrival ? "" : "Main St",
    point: null,
    isArrival,
  };
}

function selection(distanceMeters: number, id = "v1:1", isArrival = false): ActiveManeuverSelection {
  return {
    active: maneuver(id, isArrival),
    distanceMeters,
    secondary: null,
    secondaryDistanceMeters: null,
  };
}

// --- Approach sequence: 600 → 540 → 400 → 210 → 40 ---
let state = initVoiceTriggerState();

let r = evaluateManeuverVoice({ state, routeVersion: "v1", selection: selection(600), locale: "fr" });
state = r.state;
assert(r.announcement === null, "no announce beyond 550");

r = evaluateManeuverVoice({ state, routeVersion: "v1", selection: selection(540), locale: "fr" });
state = r.state;
assert(r.announcement?.bucket === "500", "500 fires on crossing 540");
assert(r.announcement?.text.startsWith("Dans 500 mètres"), "500 phrase");

r = evaluateManeuverVoice({ state, routeVersion: "v1", selection: selection(400), locale: "fr" });
state = r.state;
assert(r.announcement === null, "no repeat 500 at 400");

r = evaluateManeuverVoice({ state, routeVersion: "v1", selection: selection(210), locale: "fr" });
state = r.state;
assert(r.announcement?.bucket === "200", "200 fires on crossing 210");

r = evaluateManeuverVoice({ state, routeVersion: "v1", selection: selection(205), locale: "fr" });
state = r.state;
assert(r.announcement === null, "no repeat 200");

r = evaluateManeuverVoice({ state, routeVersion: "v1", selection: selection(40), locale: "fr" });
state = r.state;
assert(r.announcement === null, "no third immediate announce");

// --- GPS jump 540 -> 470 on FIRST observation still triggers 500 ---
let jumpState = initVoiceTriggerState();
const jump = evaluateManeuverVoice({
  state: jumpState,
  routeVersion: "j1",
  selection: selection(470, "j1:1"),
  locale: "fr",
});
assert(jump.announcement?.bucket === "500", "GPS jump into 500 band still fires");

// --- Maneuver first appears already close (reroute) → 200, not 500 ---
let closeState = initVoiceTriggerState();
const close = evaluateManeuverVoice({
  state: closeState,
  routeVersion: "c1",
  selection: selection(150, "c1:1"),
  locale: "fr",
});
assert(close.announcement?.bucket === "200", "close appearance skips 500 → 200");

// --- Reroute resets memory (new routeVersion) ---
let rerouteState = jump.state;
const reroute = evaluateManeuverVoice({
  state: rerouteState,
  routeVersion: "j2",
  selection: selection(480, "j2:1"),
  locale: "fr",
});
assert(reroute.announcement?.bucket === "500", "reroute resets and re-announces 500");

// --- Arrival announcement ---
let arrState = initVoiceTriggerState();
const arr = evaluateManeuverVoice({
  state: arrState,
  routeVersion: "a1",
  selection: selection(55, "a1:9", true),
  locale: "fr",
});
assert(arr.announcement?.bucket === "arrival", "arrival bucket fires within 60m");

// --- Priority arbitration: nav 200 beats safety 500 ---
const nav200: VoiceAnnouncement = {
  bucket: "200",
  maneuverId: "m",
  text: "nav",
  priority: VoicePriority.Nav200,
};
const safety500: VoiceAnnouncement = {
  bucket: "500",
  maneuverId: "s",
  text: "safety",
  priority: VoicePriority.Safety500,
};
const arb = resolveVoicePriority([safety500, nav200]);
assert(arb.primary?.text === "nav", "nav200 wins over safety500");
assert(arb.deferred.length === 1 && arb.deferred[0].text === "safety", "safety deferred");

console.log("navigationVoiceTriggers tests passed");
