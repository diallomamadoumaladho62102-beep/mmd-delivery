/** Feature flags for country + region experience control (rollback-safe). */

export function isPlatformScopeGatesEnabled(): boolean {
  return String(process.env.PLATFORM_SCOPE_GATES_ENABLED ?? "")
    .trim()
    .toLowerCase() === "true";
}

export function isPlatformUsStateGatesEnabled(): boolean {
  const explicit = String(process.env.PLATFORM_US_STATE_GATES ?? "")
    .trim()
    .toLowerCase();
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  return isPlatformScopeGatesEnabled();
}

export function isPlatformGnZoneGatesEnabled(): boolean {
  const explicit = String(process.env.PLATFORM_GN_ZONE_GATES ?? "")
    .trim()
    .toLowerCase();
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  return isPlatformScopeGatesEnabled();
}

/** When true, backend route gates stay country-only; UI still uses scope APIs. */
export function isPlatformUiFeaturesOnly(): boolean {
  return String(process.env.PLATFORM_UI_FEATURES_ONLY ?? "")
    .trim()
    .toLowerCase() === "true";
}

export function shouldApplyRegionCommercialOverride(countryCode: string): boolean {
  const code = countryCode.trim().toUpperCase();
  if (code === "US") return isPlatformUsStateGatesEnabled();
  if (code === "GN") return isPlatformGnZoneGatesEnabled();
  return isPlatformScopeGatesEnabled();
}
