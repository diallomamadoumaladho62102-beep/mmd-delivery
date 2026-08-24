import {
  getPricingBusinessDefault,
  type PricingBusinessDefaultKey,
} from "@/lib/pricingEngine/config/businessDefaults";
import {
  ROUTE_DISTANCE_LIMIT_DEFAULTS,
  routeDistanceLimitUserMessage as sharedRouteDistanceLimitUserMessage,
} from "../../../../shared/routeDistanceLimits";

export type RouteDistanceService = "taxi" | "delivery";

export { ROUTE_DISTANCE_LIMIT_DEFAULTS };

const SERVICE_LIMIT_KEY: Record<
  RouteDistanceService,
  PricingBusinessDefaultKey
> = {
  taxi: "taxi_max_distance_miles",
  delivery: "delivery_max_distance_miles",
};

export function getRouteDistanceLimitMiles(service: RouteDistanceService): number {
  const key = SERVICE_LIMIT_KEY[service];
  const fallback = ROUTE_DISTANCE_LIMIT_DEFAULTS[key];
  const raw = getPricingBusinessDefault(key);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return raw;
}

export function isRouteDistanceWithinLimit(
  distanceMiles: unknown,
  service: RouteDistanceService,
): boolean {
  const miles = Number(distanceMiles);
  if (!Number.isFinite(miles) || miles <= 0) return false;
  return miles <= getRouteDistanceLimitMiles(service);
}

export type RouteDistanceLimitErrorCode =
  | "route_unavailable"
  | "taxi_distance_too_far"
  | "delivery_distance_too_far";

export function evaluateRouteDistanceLimit(
  distanceMiles: unknown,
  service: RouteDistanceService,
): { ok: true } | { ok: false; code: RouteDistanceLimitErrorCode } {
  const miles = Number(distanceMiles);
  if (!Number.isFinite(miles) || miles <= 0) {
    return { ok: false, code: "route_unavailable" };
  }
  if (miles > getRouteDistanceLimitMiles(service)) {
    return {
      ok: false,
      code:
        service === "taxi" ? "taxi_distance_too_far" : "delivery_distance_too_far",
    };
  }
  return { ok: true };
}

export function assertRouteDistanceWithinLimit(
  distanceMiles: unknown,
  service: RouteDistanceService,
): void {
  const result = evaluateRouteDistanceLimit(distanceMiles, service);
  if (result.ok === false) {
    throw new Error(result.code);
  }
}

export function routeDistanceLimitUserMessage(
  code: string,
  locale: "en" | "fr" = "en",
): string | null {
  return sharedRouteDistanceLimitUserMessage(code, {
    taxi: getRouteDistanceLimitMiles("taxi"),
    delivery: getRouteDistanceLimitMiles("delivery"),
  }, locale);
}
