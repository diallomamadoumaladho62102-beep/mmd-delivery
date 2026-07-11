// Tests the shared Edge Function validators/legal-gating (single source of
// truth, imported by relative path from supabase/functions/_shared).
import {
  isCameraCategory,
  resolveEnabledTypes,
  validateBbox,
} from "../../../../supabase/functions/_shared/roadSafetyValidation";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// --- bbox validation ---
assert(validateBbox({ south: 0, west: 0, north: 1, east: 1 }).ok === true, "valid bbox");
assert(validateBbox(null).ok === false, "missing bbox rejected");
assert(validateBbox({ south: 0, west: 0, north: "x", east: 1 }).ok === false, "non-numeric rejected");
const unordered = validateBbox({ south: 2, west: 0, north: 1, east: 1 });
assert(unordered.ok === false && unordered.reason === "unordered", "unordered rejected");
const tooBig = validateBbox({ south: 0, west: 0, north: 5, east: 5 }, 2);
assert(tooBig.ok === false && tooBig.reason === "too_large", "oversized bbox rejected");
const latBad = validateBbox({ south: -100, west: 0, north: 1, east: 1 });
assert(latBad.ok === false, "lat out of range rejected");

// --- legal gating in resolveEnabledTypes ---
assert(isCameraCategory("speed_camera") && isCameraCategory("red_light_camera"), "camera categories");
assert(!isCameraCategory("stop_sign"), "stop is not camera category");

// Cameras enabled but legal unknown → cameras excluded, others included.
const unknown = resolveEnabledTypes({
  enable_speed_camera: true,
  enable_red_light_camera: true,
  enable_stop_sign: true,
  enable_school_zone: true,
  enable_speed_limit: true,
  legal_status: "unknown",
});
assert(!unknown.includes("speed_camera"), "unknown legal → no speed camera");
assert(!unknown.includes("red_light_camera"), "unknown legal → no red-light");
assert(unknown.includes("stop_sign") && unknown.includes("school_zone") && unknown.includes("speed_limit"), "non-camera surfaced");

// Cameras + allowed → surfaced.
const allowed = resolveEnabledTypes({ enable_speed_camera: true, legal_status: "allowed" });
assert(allowed.includes("speed_camera"), "allowed legal → speed camera surfaced");

// Restricted/disabled → cameras excluded.
assert(!resolveEnabledTypes({ enable_speed_camera: true, legal_status: "restricted" }).includes("speed_camera"), "restricted → no camera");
assert(!resolveEnabledTypes({ enable_speed_camera: true, legal_status: "disabled" }).includes("speed_camera"), "disabled → no camera");

// Empty config → sensible defaults (stop/school/limit on).
const empty = resolveEnabledTypes(null);
assert(empty.includes("stop_sign") && !empty.includes("speed_camera"), "defaults: stop on, camera off");

console.log("roadSafetyValidation tests passed");
