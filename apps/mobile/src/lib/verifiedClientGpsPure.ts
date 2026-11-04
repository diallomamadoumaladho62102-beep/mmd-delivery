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

export function verifiedGpsUserMessage(result: VerifiedGpsErr): {
  key: string;
  defaultValue: string;
} {
  if (result.code === "services_off") {
    return {
      key: "gps.servicesOff",
      defaultValue:
        "Impossible de déterminer votre position exacte. Activez votre GPS et réessayez.",
    };
  }
  if (result.code === "permission_denied" || result.code === "permission_blocked") {
    return {
      key: "gps.permissionRequired",
      defaultValue:
        "Impossible de déterminer votre position exacte. Autorisez la localisation et réessayez.",
    };
  }
  if (result.code === "weak_accuracy") {
    return {
      key: "gps.weakAccuracy",
      defaultValue:
        "Impossible de déterminer votre position exacte. Précision GPS insuffisante — réessayez à l’extérieur ou attendez un meilleur signal.",
    };
  }
  if (result.code === "stale") {
    return {
      key: "gps.stale",
      defaultValue:
        "Impossible de déterminer votre position exacte. La position GPS est trop ancienne — réessayez.",
    };
  }
  return {
    key: result.messageKey,
    defaultValue:
      result.messageDefault ||
      "Impossible de déterminer votre position exacte. Activez votre GPS et réessayez.",
  };
}

/** Detect accidental use of the Conakry map-camera default as a "real" pickup. */
export function isGuineaMapCameraDefault(lat: number, lng: number, epsilon = 0.0003): boolean {
  return Math.abs(lat - 9.6412) < epsilon && Math.abs(lng - -13.5784) < epsilon;
}
