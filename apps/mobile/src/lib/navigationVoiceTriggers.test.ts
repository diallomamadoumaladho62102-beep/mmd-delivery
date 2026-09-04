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

function selection(
  distanceMeters: number,
  id = "v1:1",
  isArrival = false,
): ActiveManeuverSelection {
  return {
    active: maneuver(id, isArrival),
    distanceMeters,
    secondary: null,
    secondaryDistanceMeters: null,
  };
}

// --- Approach: one instruction when entering band; GPS spam must not re-fire ---
let state = initVoiceTriggerState();

let r = evaluateManeuverVoice({
  state,
  routeVersion: "v1",
  selection: selection(600),
  locale: "fr",
});
state = r.state;
assert(r.announcement === null, "no announce beyond 550");

r = evaluateManeuverVoice({
  state,
  routeVersion: "v1",
  selection: selection(540),
  locale: "fr",
});
state = r.state;
assert(r.announcement?.bucket === "500", "500 fires on crossing 540");
assert(
  r.announcement?.text ===
    "Dans 500 mètres, tournez à droite sur Main St",
  "locked complete 500 phrase",
);

r = evaluateManeuverVoice({
  state,
  routeVersion: "v1",
  selection: selection(400),
  locale: "fr",
});
state = r.state;
assert(r.announcement === null, "no second approach announce at 400");

r = evaluateManeuverVoice({
  state,
  routeVersion: "v1",
  selection: selection(210),
  locale: "fr",
});
state = r.state;
assert(r.announcement === null, "200 band does not fire second instruction");

r = evaluateManeuverVoice({
  state,
  routeVersion: "v1",
  selection: selection(99),
  locale: "fr",
});
state = r.state;
assert(r.announcement === null, "99m GPS tick does not reinvent instruction");

r = evaluateManeuverVoice({
  state,
  routeVersion: "v1",
  selection: selection(40),
  locale: "fr",
});
state = r.state;
assert(r.announcement === null, "no third announce near turn");

// --- GPS jump into band still triggers once ---
const jump = evaluateManeuverVoice({
  state: initVoiceTriggerState(),
  routeVersion: "j1",
  selection: selection(470, "j1:1"),
  locale: "fr",
});
assert(jump.announcement?.bucket === "500", "GPS jump into 500 band still fires");

// --- Already close (reroute) → near locked distance, still one instruction ---
const close = evaluateManeuverVoice({
  state: initVoiceTriggerState(),
  routeVersion: "c1",
  selection: selection(150, "c1:1"),
  locale: "fr",
});
assert(close.announcement?.bucket === "200", "close appearance uses near lock");
assert(
  close.announcement?.text.startsWith("Dans 200 mètres"),
  "near distance locked in complete phrase",
);

// --- Reroute resets memory ---
const reroute = evaluateManeuverVoice({
  state: jump.state,
  routeVersion: "j2",
  selection: selection(480, "j2:1"),
  locale: "fr",
});
assert(reroute.announcement?.bucket === "500", "reroute resets and re-announces");

// --- Arrival ---
const arr = evaluateManeuverVoice({
  state: initVoiceTriggerState(),
  routeVersion: "a1",
  selection: selection(55, "a1:9", true),
  locale: "fr",
});
assert(arr.announcement?.bucket === "arrival", "arrival bucket fires within 60m");

// --- Priority arbitration ---
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
assert(
  arb.deferred.length === 1 && arb.deferred[0].text === "safety",
  "safety deferred",
);

// --- Hard lock: announced maneuver never re-fires ---
let capState = initVoiceTriggerState();
capState = {
  routeVersion: "cap",
  byManeuver: {
    "cap:1": {
      announced: true,
      arrival: false,
      spokenCount: 1,
    },
  },
};
const capped = evaluateManeuverVoice({
  state: capState,
  routeVersion: "cap",
  selection: selection(180, "cap:1"),
  locale: "en",
});
assert(capped.announcement === null, "announced=true blocks further announce");

console.log("navigationVoiceTriggers tests passed");
