import {
  DEFAULT_RUNTIME_CONFIG,
  isCategoryEnabled,
  resolveRuntimeConfig,
} from "./roadSafetyConfig";

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

// --- Defaults when backend unreachable (conservative: cameras OFF) ---
const def = resolveRuntimeConfig(null);
assert(def.enableSpeedCamera === false, "camera off by default (legal safe)");
assert(def.enableStopSign === true, "stop on by default");
assert(def.announceFarMeters === 500 && def.announceNearMeters === 200, "default thresholds");

// --- Merge backend row (snake_case) onto defaults ---
const merged = resolveRuntimeConfig({
  enable_speed_camera: true,
  enable_red_light_camera: true,
  overspeed_tolerance_kmh: 5,
  corridor_radius_meters: 30,
  min_confidence: 0.7,
});
assert(merged.enableSpeedCamera === true, "camera enabled per country");
assert(merged.enableRedLightCamera === true, "red-light enabled per country");
assert(merged.overspeedToleranceKmh === 5, "tolerance overridden");
assert(merged.corridorRadiusMeters === 30, "corridor overridden");
assert(merged.minConfidence === 0.7, "min confidence overridden");
// Untouched fields keep defaults.
assert(merged.enableStopSign === DEFAULT_RUNTIME_CONFIG.enableStopSign, "unset keeps default");

// --- Invalid values fall back to defaults ---
const bad = resolveRuntimeConfig({
  announce_far_meters: Number.NaN,
  min_confidence: "oops" as unknown as number,
});
assert(bad.announceFarMeters === 500, "NaN → default");
assert(bad.minConfidence === 0.5, "invalid → default");

// --- Per-country legal gating ---
const camerasDisabled = resolveRuntimeConfig({ enable_speed_camera: false });
assert(
  isCategoryEnabled(camerasDisabled, "speed_camera") === false,
  "disabled camera category not shown (legal restriction respected)",
);
assert(isCategoryEnabled(camerasDisabled, "stop_sign") === true, "stop still enabled");
assert(isCategoryEnabled(merged, "speed_camera") === true, "enabled camera shown");

console.log("roadSafetyConfig tests passed");
