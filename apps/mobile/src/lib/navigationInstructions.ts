import type { NavigationRouteStep } from "./navigationService";
import type { NavigationStage } from "./driverNavigation/types";

export type NavigationInstruction = {
  title: string;
  subtitle: string;
  maneuverDistanceMeters: number;
  distanceMeters: number;
  voiceText: string;
  maneuverType?: string;
};

export function formatNavigationDistance(
  meters: number,
  locale = "en",
): string {
  if (!Number.isFinite(meters)) return "—";

  const useMetric = !locale.startsWith("en");

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

export function buildNavigationInstruction(params: {
  remainingMeters: number;
  stage: NavigationStage;
  steps?: NavigationRouteStep[];
  locale?: string;
}): NavigationInstruction {
  const { remainingMeters, stage, steps = [], locale = "en" } = params;
  const currentStep = pickCurrentStep(steps, remainingMeters);
  const maneuverDistanceMeters = currentStep?.distanceMeters ?? remainingMeters;
  const maneuverDistanceText = formatNavigationDistance(
    maneuverDistanceMeters,
    locale,
  );
  const totalRemainingText = formatNavigationDistance(remainingMeters, locale);

  if (currentStep?.instruction) {
    return {
      title: currentStep.instruction,
      subtitle: totalRemainingText,
      maneuverDistanceMeters,
      distanceMeters: remainingMeters,
      voiceText: `${maneuverDistanceText}. ${currentStep.instruction}.`,
      maneuverType: currentStep.instruction.split(" ")[0]?.toLowerCase(),
    };
  }

  const fallbackTitle =
    stage === "pickup"
      ? locale.startsWith("fr")
        ? "Dirigez-vous vers le pickup"
        : "Head to pickup location"
      : locale.startsWith("fr")
        ? "Dirigez-vous vers le dropoff"
        : "Head to dropoff location";

  return {
    title: fallbackTitle,
    subtitle: totalRemainingText,
    maneuverDistanceMeters,
    distanceMeters: remainingMeters,
    voiceText: `${fallbackTitle}. ${totalRemainingText} remaining.`,
  };
}
