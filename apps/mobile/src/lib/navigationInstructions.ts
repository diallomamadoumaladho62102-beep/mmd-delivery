import type { NavigationRouteStep } from "./navigationService";
import type { NavigationStage } from "./driverNavigation/types";

export type NavigationInstruction = {
  title: string;
  subtitle: string;
  distanceMeters: number;
  voiceText: string;
};

export function formatNavigationDistance(meters: number): string {
  if (!Number.isFinite(meters)) return "—";

  if (meters < 160) {
    return `${Math.max(30, Math.round(meters / 10) * 10)} m`;
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
}): NavigationInstruction {
  const { remainingMeters, stage, steps = [] } = params;
  const place = stage === "pickup" ? "pickup location" : "dropoff location";
  const distanceText = formatNavigationDistance(remainingMeters);
  const currentStep = pickCurrentStep(steps, remainingMeters);

  if (currentStep?.instruction) {
    return {
      title: currentStep.instruction,
      subtitle: `${distanceText} remaining`,
      distanceMeters: remainingMeters,
      voiceText: `${currentStep.instruction}. ${distanceText} remaining.`,
    };
  }

  return {
    title: stage === "pickup" ? "Head to pickup location" : "Head to dropoff location",
    subtitle: `${distanceText} remaining`,
    distanceMeters: remainingMeters,
    voiceText: `Continue to the ${place}. ${distanceText} remaining.`,
  };
}
