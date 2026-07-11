import {
  confidenceLevel,
  formatSafetyDistanceLabel,
  safetyBadgeModel,
} from "./roadSafetyDisplay";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// --- localized badge models ---
const camFr = safetyBadgeModel("speed_camera", "fr");
assert(camFr.title === "Radar de vitesse", "FR speed camera title");
assert(camFr.icon === "camera", "camera icon");
assert(!!camFr.colors.bg && !!camFr.colors.ring, "camera colors present");

const stopEn = safetyBadgeModel("stop_sign", "en");
assert(stopEn.title === "Stop sign", "EN stop title");
const schoolEs = safetyBadgeModel("school_zone", "es");
assert(schoolEs.title === "Zona escolar", "ES school title");
const redLight = safetyBadgeModel("red_light_camera", "fr");
assert(redLight.title === "Radar de feu rouge", "FR red-light distinct from speed camera");
assert(redLight.colors.ring !== camFr.colors.ring, "red-light color distinct from speed camera");

// --- distance labels ---
assert(formatSafetyDistanceLabel(184, "fr") === "180 m", "rounds to 10m");
assert(formatSafetyDistanceLabel(1500, "en") === "1.5 km", "km for >=1000m");
assert(formatSafetyDistanceLabel(-5, "fr") === "—", "invalid distance placeholder");

// --- confidence buckets (for unknown/low-confidence handling) ---
assert(confidenceLevel(0.9) === "high", "0.9 high");
assert(confidenceLevel(0.6) === "medium", "0.6 medium");
assert(confidenceLevel(0.3) === "low", "0.3 low");
assert(confidenceLevel(undefined) === "low", "undefined → low (unknown)");

console.log("roadSafetyDisplay tests passed");
