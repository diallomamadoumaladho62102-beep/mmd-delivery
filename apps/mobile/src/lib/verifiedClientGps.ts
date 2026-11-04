import * as Location from "expo-location";
import {
  isGuineaMapCameraDefault,
  verifiedGpsUserMessage,
  type VerifiedGpsErr,
  type VerifiedGpsOk,
  type VerifiedGpsResult,
} from "./verifiedClientGpsPure";

export {
  isGuineaMapCameraDefault,
  verifiedGpsUserMessage,
  type VerifiedGpsErr,
  type VerifiedGpsOk,
  type VerifiedGpsResult,
} from "./verifiedClientGpsPure";

/**
 * Verified client GPS for pickup / collecte.
 * Never returns a city center, cached stale fix, or IP-derived point as "GPS".
 */

const DEFAULT_MAX_ACCURACY_M = 100;
const DEFAULT_MAX_AGE_MS = 45_000;
const DEFAULT_TIMEOUT_MS = 15_000;

function err(
  code: VerifiedGpsErr["code"],
  messageKey: string,
  messageDefault: string,
  accuracyM: number | null = null,
  ageMs: number | null = null
): VerifiedGpsErr {
  return { ok: false, code, messageKey, messageDefault, accuracyM, ageMs };
}

/**
 * Fresh GPS only. Does not use getLastKnownPositionAsync as a verified fix.
 * City centers (Conakry, Labé, …) are never returned.
 */
export async function getVerifiedClientGps(options?: {
  maxAccuracyM?: number;
  maxAgeMs?: number;
  timeoutMs?: number;
  accuracy?: Location.LocationAccuracy;
}): Promise<VerifiedGpsResult> {
  const maxAccuracyM = options?.maxAccuracyM ?? DEFAULT_MAX_ACCURACY_M;
  const maxAgeMs = options?.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const accuracy = options?.accuracy ?? Location.Accuracy.High;

  try {
    const services = await Location.hasServicesEnabledAsync();
    if (!services) {
      return err(
        "services_off",
        "gps.servicesOff",
        "Impossible de déterminer votre position exacte. Activez votre GPS et réessayez."
      );
    }

    const current = await Location.getForegroundPermissionsAsync();
    let status = current.status;
    let canAskAgain = current.canAskAgain;
    if (status !== Location.PermissionStatus.GRANTED) {
      const asked = await Location.requestForegroundPermissionsAsync();
      status = asked.status;
      canAskAgain = asked.canAskAgain;
    }
    if (status !== Location.PermissionStatus.GRANTED) {
      return err(
        canAskAgain === false ? "permission_blocked" : "permission_denied",
        "gps.permissionRequired",
        "Impossible de déterminer votre position exacte. Autorisez la localisation et réessayez."
      );
    }

    const position = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy }),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);

    if (!position) {
      return err(
        "timeout",
        "gps.timeout",
        "Impossible de déterminer votre position exacte. Activez votre GPS et réessayez."
      );
    }

    const lat = Number(position.coords.latitude);
    const lng = Number(position.coords.longitude);
    const accuracyM = position.coords.accuracy;
    const timestamp = Number(position.timestamp ?? Date.now());
    const ageMs = Math.max(0, Date.now() - timestamp);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return err("invalid", "gps.invalid", "Impossible de déterminer votre position exacte. Activez votre GPS et réessayez.");
    }
    if (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001) {
      return err("invalid", "gps.invalid", "Impossible de déterminer votre position exacte. Activez votre GPS et réessayez.");
    }
    if (!Number.isFinite(accuracyM) || accuracyM == null || accuracyM <= 0) {
      return err(
        "weak_accuracy",
        "gps.weakAccuracy",
        "Impossible de déterminer votre position exacte. Précision GPS insuffisante — réessayez.",
        null,
        ageMs
      );
    }
    if (accuracyM > maxAccuracyM) {
      return err(
        "weak_accuracy",
        "gps.weakAccuracy",
        "Impossible de déterminer votre position exacte. Précision GPS insuffisante — réessayez.",
        accuracyM,
        ageMs
      );
    }
    if (ageMs > maxAgeMs) {
      return err("stale", "gps.stale", "Impossible de déterminer votre position exacte. La position GPS est trop ancienne — réessayez.", accuracyM, ageMs);
    }

    return {
      ok: true,
      latitude: lat,
      longitude: lng,
      accuracyM,
      timestamp,
      source: "device_gps",
    };
  } catch {
    return err(
      "unavailable",
      "gps.unavailable",
      "Impossible de déterminer votre position exacte. Activez votre GPS et réessayez."
    );
  }
}
