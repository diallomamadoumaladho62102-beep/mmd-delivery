export const ROUTE_DISTANCE_LIMIT_DEFAULTS = {
  taxi_max_distance_miles: 300,
  delivery_max_distance_miles: 60,
} as const;

export type RouteDistanceLimitErrorCode =
  | "taxi_distance_too_far"
  | "delivery_distance_too_far"
  | "distance_too_far";

export function routeDistanceLimitUserMessage(
  code: string,
  maxMiles?: { taxi?: number; delivery?: number },
  locale: "en" | "fr" = "en",
): string | null {
  const taxiMax =
    maxMiles?.taxi ?? ROUTE_DISTANCE_LIMIT_DEFAULTS.taxi_max_distance_miles;
  const deliveryMax =
    maxMiles?.delivery ?? ROUTE_DISTANCE_LIMIT_DEFAULTS.delivery_max_distance_miles;

  if (
    code === "taxi_distance_too_far" ||
    code === "distance_too_far"
  ) {
    return locale === "fr"
      ? `Cette course dépasse la distance maximale autorisée de ${taxiMax} miles.`
      : `This trip exceeds the maximum allowed taxi distance of ${taxiMax} miles.`;
  }
  if (code === "delivery_distance_too_far") {
    return locale === "fr"
      ? `Cette livraison dépasse la distance maximale autorisée de ${deliveryMax} miles.`
      : `This delivery exceeds the maximum allowed delivery distance of ${deliveryMax} miles.`;
  }
  return null;
}
