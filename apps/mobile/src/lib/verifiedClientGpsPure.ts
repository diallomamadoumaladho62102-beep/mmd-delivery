export type VerifiedGpsOk = {
  ok: true;
  latitude: number;
  longitude: number;
  accuracyM: number;
  timestamp: number;
  source: "device_gps";
};

export type VerifiedGpsErr = {
  ok: false;
  code:
    | "services_off"
    | "permission_denied"
    | "permission_blocked"
    | "timeout"
    | "weak_accuracy"
    | "stale"
    | "unavailable"
    | "invalid";
  messageKey: string;
  messageDefault: string;
  accuracyM: number | null;
  ageMs: number | null;
};

export type VerifiedGpsResult = VerifiedGpsOk | VerifiedGpsErr;

/** English source strings. Locale catalogs carry fr, es, ar, zh, and ff. */
export const GPS_DEFAULTS = {
  unavailable: "Unable to determine your exact position. Turn on GPS and try again.",
  mustVerifyBeforePin:
    "Unable to determine your exact position. Turn on GPS before placing the pin.",
  servicesOff: "Unable to determine your exact position. Turn on GPS and try again.",
  permissionRequired:
    "Unable to determine your exact position. Allow location access and try again.",
  weakAccuracy:
    "Unable to determine your exact position. GPS accuracy is too low — try again outdoors or wait for a better signal.",
  stale: "Unable to determine your exact position. The GPS position is too old — try again.",
  timeout: "Unable to determine your exact position. Turn on GPS and try again.",
  invalid: "Unable to determine your exact position. Turn on GPS and try again.",
} as const;

export function verifiedGpsUserMessage(result: VerifiedGpsErr): {
  key: string;
  defaultValue: string;
} {
  if (result.code === "services_off") {
    return { key: "gps.servicesOff", defaultValue: GPS_DEFAULTS.servicesOff };
  }
  if (result.code === "permission_denied" || result.code === "permission_blocked") {
    return { key: "gps.permissionRequired", defaultValue: GPS_DEFAULTS.permissionRequired };
  }
  if (result.code === "weak_accuracy") {
    return { key: "gps.weakAccuracy", defaultValue: GPS_DEFAULTS.weakAccuracy };
  }
  if (result.code === "stale") {
    return { key: "gps.stale", defaultValue: GPS_DEFAULTS.stale };
  }
  return {
    key: result.messageKey,
    defaultValue: result.messageDefault || GPS_DEFAULTS.unavailable,
  };
}

/** Detect accidental use of the Conakry map-camera default as a "real" pickup. */
export function isGuineaMapCameraDefault(lat: number, lng: number, epsilon = 0.0003): boolean {
  return Math.abs(lat - 9.6412) < epsilon && Math.abs(lng - -13.5784) < epsilon;
}
