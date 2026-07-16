import type { NavigationRouteStep } from "./navigationService";
import type { NavigationStage } from "./driverNavigation/types";
import type { NavigationLane } from "./navigationLanes";
import {
  formatManeuverDistanceLabel,
  resolveNavigationLocale,
  type NavigationLocale,
} from "./navigationLocale";

export type NavigationInstruction = {
  title: string;
  subtitle: string;
  maneuverDistanceMeters: number;
  distanceMeters: number;
  voiceText: string;
  maneuverType?: string;
  secondaryTitle?: string;
  secondaryManeuverType?: string;
  secondaryDistanceMeters?: number;
  lanes?: NavigationLane[];
};

export function formatNavigationDistance(
  meters: number,
  locale: string | NavigationLocale = "en",
): string {
  if (!Number.isFinite(meters)) return "—";

  const resolved = typeof locale === "string" ? resolveNavigationLocale(locale) : locale;
  const useMetric = resolved !== "en";

  if (useMetric) {
    if (meters < 1000) {
      return `${Math.max(30, Math.round(meters / 10) * 10)} m`;
    }
    return `${(meters / 1000).toFixed(1)} km`;
  }

  if (meters < 160) {
    const feet = Math.max(50, Math.round(meters * 3.28084 / 50) * 50);
    return `${feet} ft`;
  }

  const miles = meters / 1609.344;
  return `${miles.toFixed(miles >= 10 ? 0 : 1)} mi`;
}

export function pickCurrentStep(
  steps: NavigationRouteStep[],
  remainingMeters: number,
): NavigationRouteStep | null {
  if (!steps.length) return null;

  let consumed = 0;
  for (const step of steps) {
    consumed += step.distanceMeters;
    if (remainingMeters <= consumed + 120) {
      return step;
    }
  }

  return steps[steps.length - 1] ?? null;
}

export function pickNextStep(
  steps: NavigationRouteStep[],
  remainingMeters: number,
): NavigationRouteStep | null {
  if (steps.length < 2) return null;

  const current = pickCurrentStep(steps, remainingMeters);
  if (!current) return null;

  const currentIndex = steps.indexOf(current);
  if (currentIndex < 0 || currentIndex >= steps.length - 1) return null;

  return steps[currentIndex + 1] ?? null;
}

function inferManeuverType(instruction: string): string | undefined {
  const token = instruction.split(" ")[0]?.toLowerCase();
  return token || undefined;
}

export function extractStreetName(instruction: string): string {
  const trimmed = instruction.trim();
  const patterns = [
    /\bsur\s+(.+)$/i,
    /\bonto\s+(.+)$/i,
    /\bon\s+(.+)$/i,
    /\bvers\s+(.+)$/i,
    /\btoward\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1].trim().replace(/[.,]$/, "");
  }

  return trimmed;
}

export function buildNavigationInstruction(params: {
  remainingMeters: number;
  stage: NavigationStage;
  steps?: NavigationRouteStep[];
  locale?: string;
}): NavigationInstruction {
  const { remainingMeters, stage, steps = [], locale: appLocale = "en" } = params;
  const locale = resolveNavigationLocale(appLocale);
  const currentStep = pickCurrentStep(steps, remainingMeters);
  const nextStep = pickNextStep(steps, remainingMeters);
  const maneuverDistanceMeters = currentStep?.distanceMeters ?? remainingMeters;
  const maneuverDistanceText = formatManeuverDistanceLabel(
    maneuverDistanceMeters,
    locale,
  );
  const totalRemainingText = formatNavigationDistance(remainingMeters, locale);

  if (currentStep?.instruction) {
    const secondaryTitle = nextStep?.instruction?.trim();
    return {
      title: currentStep.instruction,
      subtitle: totalRemainingText,
      maneuverDistanceMeters,
      distanceMeters: remainingMeters,
      voiceText: `${maneuverDistanceText}. ${currentStep.instruction}.`,
      maneuverType: inferManeuverType(currentStep.instruction),
      secondaryTitle: secondaryTitle || undefined,
      secondaryManeuverType: secondaryTitle
        ? inferManeuverType(secondaryTitle)
        : undefined,
      secondaryDistanceMeters: nextStep?.distanceMeters,
    };
  }

  const fallbackTitle =
    stage === "pickup"
      ? locale === "fr"
        ? "Dirigez-vous vers le pickup"
        : locale === "es"
          ? "Dirígete al punto de recogida"
          : "Head to pickup location"
      : locale === "fr"
        ? "Dirigez-vous vers le dropoff"
        : locale === "es"
          ? "Dirígete al punto de entrega"
          : "Head to dropoff location";

  return {
    title: fallbackTitle,
    subtitle: totalRemainingText,
    maneuverDistanceMeters,
    distanceMeters: remainingMeters,
    voiceText: `${fallbackTitle}. ${totalRemainingText} remaining.`,
  };
}
