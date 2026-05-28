export type NavigationInstruction = {
  title: string;
  subtitle: string;
  distanceMeters: number;
  voiceText: string;
};

export function formatNavigationDistance(meters: number) {
  if (!Number.isFinite(meters)) return "—";

  if (meters < 160) {
    return `${Math.max(30, Math.round(meters / 10) * 10)} m`;
  }

  const miles = meters / 1609.344;
  return `${miles.toFixed(miles >= 10 ? 0 : 1)} mi`;
}

export function buildNavigationInstruction(
  distanceMeters: number,
  stage: "pickup" | "dropoff" = "pickup",
): NavigationInstruction {
  const place =
    stage === "pickup" ? "pickup location" : "dropoff location";

  const distanceText = formatNavigationDistance(distanceMeters);

  return {
    title: `Head to ${place}`,
    subtitle: `${distanceText} remaining`,
    distanceMeters,
    voiceText: `Continue to the ${place}. ${distanceText} remaining.`,
  };
}