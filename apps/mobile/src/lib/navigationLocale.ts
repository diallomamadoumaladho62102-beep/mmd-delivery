export type NavigationLocale = "en" | "fr" | "es";

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

export function formatManeuverDistanceLabel(
  meters: number,
  locale: NavigationLocale,
): string {
  if (!Number.isFinite(meters)) return "—";

  if (locale === "fr") {
    if (meters < 1000) {
      const rounded = Math.max(30, Math.round(meters / 10) * 10);
      return `Dans ${rounded} m`;
    }
    return `Dans ${(meters / 1000).toFixed(1)} km`;
  }

  if (meters < 160) {
    const feet = Math.max(50, Math.round(meters * 3.28084 / 50) * 50);
    return `In ${feet} ft`;
  }

  const miles = meters / 1609.344;
  const value = miles >= 10 ? miles.toFixed(0) : miles.toFixed(1);
  return `In ${value} mi`;
}

export function formatTripDistance(
  meters: number,
  locale: NavigationLocale,
): string {
  if (!Number.isFinite(meters) || meters <= 0) return "—";

  if (locale === "fr") {
    if (meters < 1000) return `${Math.max(50, Math.round(meters / 50) * 50)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  }

  if (meters < 1600) {
    return `${Math.max(100, Math.round(meters / 50) * 50)} m`;
  }

  return `${(meters / 1609.344).toFixed(1)} mi`;
}

export function formatThenPrefix(locale: NavigationLocale): string {
  if (locale === "fr") return "Puis";
  if (locale === "es") return "Luego";
  return "Then";
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
