export type NavigationLocale = "en" | "fr" | "es";

/** Distance/speed unit system driven by market country, with locale fallback. */
export type DistanceUnitSystem = "imperial" | "metric";

const IMPERIAL_COUNTRIES = new Set([
  "US",
  "USA",
  "LR",
  "MM",
  "GB",
  "UK",
]);

export function resolveUnitSystem(
  countryCode?: string | null,
  locale?: NavigationLocale,
): DistanceUnitSystem {
  const country = String(countryCode ?? "")
    .trim()
    .toUpperCase();
  if (country && IMPERIAL_COUNTRIES.has(country)) return "imperial";
  if (country && country.length === 2) return "metric";
  // Locale fallback when country unknown — en → imperial, else metric.
  return locale === "en" ? "imperial" : "metric";
}

/** Single language for Mapbox directions + HUD copy (no mixed UI). */
export function resolveNavigationLocale(appLocale: string): NavigationLocale {
  const base = String(appLocale || "en")
    .trim()
    .toLowerCase()
    .split("-")[0];

  if (base.startsWith("fr") || base === "ff") return "fr";
  if (base.startsWith("es")) return "es";
  return "en";
}

export function isFrenchNavigationLocale(locale: NavigationLocale): boolean {
  return locale === "fr";
}

/** Plain distance (no "In/Dans" prefix) for secondary maneuver / trip bar. */
export function formatNavigationDistancePlain(
  meters: number,
  units: DistanceUnitSystem,
): string {
  if (!Number.isFinite(meters)) return "—";

  if (units === "metric") {
    if (meters < 1000) {
      return `${Math.max(30, Math.round(meters / 10) * 10)} m`;
    }
    return `${(meters / 1000).toFixed(1)} km`;
  }

  if (meters < 160) {
    const feet = Math.max(50, Math.round((meters * 3.28084) / 50) * 50);
    return `${feet} ft`;
  }

  const miles = meters / 1609.344;
  return `${miles.toFixed(miles >= 10 ? 0 : 1)} mi`;
}

export function formatManeuverDistanceLabel(
  meters: number,
  locale: NavigationLocale,
  units?: DistanceUnitSystem,
): string {
  if (!Number.isFinite(meters)) return "—";
  const system =
    units ?? (locale === "fr" || locale === "es" ? "metric" : "imperial");
  const plain = formatNavigationDistancePlain(meters, system);

  if (locale === "fr") return `Dans ${plain}`;
  if (locale === "es") return `En ${plain}`;
  return `In ${plain}`;
}

export function formatTripDistance(
  meters: number,
  locale: NavigationLocale,
  units?: DistanceUnitSystem,
): string {
  if (!Number.isFinite(meters) || meters <= 0) return "—";
  const system =
    units ?? (locale === "fr" || locale === "es" ? "metric" : "imperial");
  return formatNavigationDistancePlain(meters, system);
}

/** Speed from m/s → mph or km/h integer string. */
export function formatSpeedValue(
  speedMps: number | null,
  units: DistanceUnitSystem,
): string {
  if (speedMps == null || !Number.isFinite(speedMps) || speedMps < 0) return "0";
  if (units === "imperial") {
    return `${Math.round(speedMps * 2.236936)}`;
  }
  return `${Math.round(speedMps * 3.6)}`;
}

export function speedUnitLabel(units: DistanceUnitSystem): string {
  return units === "imperial" ? "mph" : "km/h";
}

/** Convert posted limit (Mapbox may be km/h or mph) to display integer. */
export function formatPostedSpeedLimit(
  postedValue: number | null,
  postedUnit: "km/h" | "mph" | null | undefined,
  displayUnits: DistanceUnitSystem,
): string | null {
  if (postedValue == null || !Number.isFinite(postedValue) || postedValue <= 0) {
    return null;
  }
  const asKmh = postedUnit === "mph" ? postedValue * 1.609344 : postedValue;
  if (displayUnits === "imperial") {
    return `${Math.round(asKmh / 1.609344)}`;
  }
  return `${Math.round(asKmh)}`;
}

export function formatThenPrefix(locale: NavigationLocale): string {
  if (locale === "fr") return "Puis";
  if (locale === "es") return "Luego";
  return "Then";
}

/** Highway exit badge — only when Mapbox provided a real exit designation. */
export function formatExitBadgeLabel(
  exitNumber: string,
  locale: NavigationLocale,
): string {
  const value = String(exitNumber ?? "").trim();
  if (!value) return "";
  if (locale === "fr") return `Sortie ${value}`;
  if (locale === "es") return `Salida ${value}`;
  return `Exit ${value}`;
}

/** Roundabout exit phrase — only when Mapbox provided `maneuver.exit`. */
export function formatRoundaboutExitLabel(
  exitIndex: number,
  locale: NavigationLocale,
): string {
  if (!Number.isFinite(exitIndex) || exitIndex <= 0) return "";
  const n = Math.round(exitIndex);
  if (locale === "fr") {
    if (n === 1) return "Prenez la 1re sortie";
    return `Prenez la ${n}e sortie`;
  }
  if (locale === "es") {
    return `Tome la salida ${n}`;
  }
  const ordinal =
    n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`;
  return `Take the ${ordinal} exit`;
}

function frenchTurnVerb(maneuverType?: string): string {
  const type = (maneuverType ?? "").toLowerCase();
  if (type.includes("left")) return "Tournez à gauche sur";
  if (type.includes("right")) return "Tournez à droite sur";
  if (type.includes("uturn") || type.includes("u-turn")) return "Faites demi-tour sur";
  if (type.includes("roundabout")) return "Prenez le rond-point vers";
  if (type.includes("merge")) return "Rejoignez";
  if (type.includes("straight") || type.includes("continue")) return "Continuez sur";
  return "Dirigez-vous vers";
}

export function formatFrenchTurnLine(
  maneuverType: string | undefined,
  streetName: string,
): string {
  const street = streetName.trim() || "votre destination";
  return `${frenchTurnVerb(maneuverType)} ${street}`;
}

export function formatFrenchSecondaryLine(
  maneuverType: string | undefined,
  instruction: string,
  streetName?: string,
): string {
  const trimmed = instruction.trim();
  const street = streetName?.trim();

  if (!street || street === trimmed || !/\b(sur|onto|on|vers)\b/i.test(trimmed)) {
    const normalized = trimmed.replace(/^[.,\s]+|[.,\s]+$/g, "");
    return `${formatThenPrefix("fr")} ${normalized.charAt(0).toLowerCase()}${normalized.slice(1)}`;
  }

  return `${formatThenPrefix("fr")} ${frenchTurnVerb(maneuverType).toLowerCase()} ${street}`;
}

export function formatRouteAltLabel(index: number, locale: NavigationLocale): string {
  if (index === 0) {
    return locale === "fr" ? "Plus rapide" : locale === "es" ? "Más rápida" : "Fastest";
  }
  if (locale === "fr") return `Alt. ${index}`;
  if (locale === "es") return `Alt. ${index}`;
  return `Alt ${index}`;
}
