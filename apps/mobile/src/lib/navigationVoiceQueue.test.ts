import {
  enqueueVoice,
  initVoiceQueue,
  pruneVoiceQueue,
  takeNextVoice,
} from "./navigationVoiceQueue";
import { VoicePriority, type VoiceAnnouncement } from "./navigationVoiceTriggers";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const navImmediate: VoiceAnnouncement = {
  bucket: "immediate",
  maneuverId: "m1",
  text: "Turn right now",
  priority: VoicePriority.ImmediateManeuver,
};
const safety500: VoiceAnnouncement = {
  bucket: "500",
  maneuverId: "safety:cam1",
  text: "Speed camera in 500 m",
  priority: VoicePriority.Safety500,
};

// --- enqueue de-dupes identical maneuver+bucket ---
let q = initVoiceQueue();
q = enqueueVoice(q, safety500, 0);
q = enqueueVoice(q, safety500, 10);
assert(q.items.length === 1, "duplicate maneuver+bucket not re-queued");

// --- takeNext respects priority (immediate beats safety) ---
q = enqueueVoice(q, navImmediate, 20);
let taken = takeNextVoice(q, 5000);
assert(taken.announcement?.maneuverId === "m1", "immediate maneuver spoken first");
q = taken.state;

// --- min gap prevents overlap ---
const blocked = takeNextVoice(q, 5100); // <3200ms since lastSpokenAt=5000
assert(blocked.announcement === null, "within gap → nothing spoken (no overlap)");
taken = takeNextVoice(q, 8300); // gap elapsed
assert(taken.announcement?.maneuverId === "safety:cam1", "safety spoken after gap");

// --- prune cancels obsolete (event now behind) before it is ever spoken ---
let q2 = enqueueVoice(initVoiceQueue(), safety500, 0);
q2 = pruneVoiceQueue(q2, 100, new Set(["m1"])); // safety:cam1 not active anymore
assert(q2.items.length === 0, "obsolete safety alert cancelled");

// --- prune drops expired items ---
let q3 = enqueueVoice(initVoiceQueue(), safety500, 0, 1000);
q3 = pruneVoiceQueue(q3, 2000, new Set(["safety:cam1"]));
assert(q3.items.length === 0, "expired item dropped");

console.log("navigationVoiceQueue tests passed");
