/**
 * Pure display models for road-safety badges/panels (labels, icons, colors).
 * Keeps the visual components thin and unit-testable.
 */
import type { RoadSafetyEventType } from "./roadSafety";
import { SAFETY_COLORS } from "../theme/navigationTheme";
import { resolveNavigationLocale, type NavigationLocale } from "./navigationLocale";

export type SafetyBadgeModel = {
  icon: string; // Ionicons glyph name
  colors: { bg: string; ring: string; icon: string };
  shortLabel: string;
  title: string;
};

const LABELS: Record<
  RoadSafetyEventType,
  { icon: string; short: Record<NavigationLocale, string>; title: Record<NavigationLocale, string> }
> = {
  speed_camera: {
    icon: "camera",
    short: { en: "Camera", fr: "Radar", es: "Radar" },
    title: { en: "Speed camera", fr: "Radar de vitesse", es: "Radar de velocidad" },
  },
  red_light_camera: {
    icon: "alert-circle",
    short: { en: "Red light", fr: "Feu rouge", es: "Semáforo" },
    title: { en: "Red light camera", fr: "Radar de feu rouge", es: "Cámara de semáforo" },
  },
  stop_sign: {
    icon: "hand-left",
    short: { en: "Stop", fr: "Stop", es: "Alto" },
    title: { en: "Stop sign", fr: "Panneau STOP", es: "Señal de alto" },
  },
  school_zone: {
    icon: "school",
    short: { en: "School", fr: "École", es: "Escuela" },
    title: { en: "School zone", fr: "Zone scolaire", es: "Zona escolar" },
  },
  speed_limit: {
    icon: "speedometer",
    short: { en: "Limit", fr: "Limite", es: "Límite" },
    title: { en: "Speed limit", fr: "Limitation", es: "Límite de velocidad" },
  },
};

export function safetyBadgeModel(
  type: RoadSafetyEventType,
  locale: string | NavigationLocale,
): SafetyBadgeModel {
  const resolved = typeof locale === "string" ? resolveNavigationLocale(locale) : locale;
  const entry = LABELS[type];
  const colors = SAFETY_COLORS[type];
  return {
    icon: entry.icon,
    colors: { bg: colors.bg, ring: colors.ring, icon: colors.icon },
    shortLabel: entry.short[resolved],
    title: entry.title[resolved],
  };
}

/** Compact distance label for safety badges/panels. */
export function formatSafetyDistanceLabel(
  meters: number,
  locale: string | NavigationLocale,
): string {
  const resolved = typeof locale === "string" ? resolveNavigationLocale(locale) : locale;
  if (!Number.isFinite(meters) || meters < 0) return "—";
  if (meters >= 1000) {
    const km = (meters / 1000).toFixed(1);
    return resolved === "en" ? `${km} km` : `${km} km`;
  }
  const rounded = Math.max(0, Math.round(meters / 10) * 10);
  return `${rounded} m`;
}

/** Confidence bucket for the small indicator dot / "unknown" state. */
export function confidenceLevel(confidence: number | undefined): "high" | "medium" | "low" {
  const c = confidence ?? 0;
  if (c >= 0.75) return "high";
  if (c >= 0.5) return "medium";
  return "low";
}
