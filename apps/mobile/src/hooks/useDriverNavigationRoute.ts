import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchNavigationRoute,
  shouldReroute,
  type NavigationRoute,
} from "../lib/navigationService";
import {
  estimateRemainingMinutes,
  getRouteProgress,
} from "../lib/navigationProgress";
import type { CoordinatePoint } from "../lib/coordinates";
import type { NavigationStage, RouteEngineStatus } from "../lib/driverNavigation/types";

const REROUTE_THRESHOLD_METERS = 110;
const REROUTE_COOLDOWN_MS = 12_000;

type UseDriverNavigationRouteParams = {
  enabled: boolean;
  driverPoint: CoordinatePoint | null;
  destination: CoordinatePoint | null;
  stage: NavigationStage;
  onNetworkFailure?: () => void;
  onNetworkSuccess?: () => void;
  onReroute?: () => void;
};

export type DriverNavigationRouteState = {
  route: NavigationRoute | null;
  status: RouteEngineStatus;
  remainingMeters: number;
  remainingMinutes: number;
  refreshRoute: () => void;
};

export function useDriverNavigationRoute(
  params: UseDriverNavigationRouteParams,
): DriverNavigationRouteState {
  const {
    enabled,
    driverPoint,
    destination,
    stage,
    onNetworkFailure,
    onNetworkSuccess,
    onReroute,
  } = params;

  const [route, setRoute] = useState<NavigationRoute | null>(null);
  const [status, setStatus] = useState<RouteEngineStatus>("idle");
  const [remainingMeters, setRemainingMeters] = useState(0);
  const [remainingMinutes, setRemainingMinutes] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const rerouteInFlightRef = useRef(false);
  const lastRerouteAtRef = useRef(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const routeRef = useRef<NavigationRoute | null>(null);

  const loadRoute = useCallback(
    async (origin: CoordinatePoint, reason: "initial" | "reroute" | "manual") => {
      if (!destination) {
        setRoute(null);
        setStatus("idle");
        setRemainingMeters(0);
        setRemainingMinutes(0);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (reason !== "reroute") {
        setStatus("loading");
      }

      try {
        const nextRoute = await fetchNavigationRoute(
          origin,
          destination,
          [],
          controller.signal,
        );

        if (controller.signal.aborted) return;

        if (!nextRoute) {
          setStatus(routeRef.current ? "stale" : "error");
          onNetworkFailure?.();
          return;
        }

        routeRef.current = nextRoute;
        setRoute(nextRoute);
        setStatus("ready");
        lastRerouteAtRef.current = Date.now();
        onNetworkSuccess?.();
        if (reason === "reroute") {
          onReroute?.();
        }

        const progress = getRouteProgress(origin, nextRoute.geometry);
        const remaining = progress?.remainingMeters ?? nextRoute.distanceMeters;
        setRemainingMeters(remaining);
        setRemainingMinutes(
          estimateRemainingMinutes(
            remaining,
            nextRoute.durationSeconds,
            nextRoute.distanceMeters,
          ),
        );
      } catch {
        if (!controller.signal.aborted) {
          setStatus(routeRef.current ? "stale" : "error");
          onNetworkFailure?.();
        }
      } finally {
        if (!controller.signal.aborted) {
          rerouteInFlightRef.current = false;
        }
      }
    },
    [destination, onNetworkFailure, onNetworkSuccess, onReroute],
  );

  const refreshRoute = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  useEffect(() => {
    if (!enabled || !driverPoint || !destination) {
      abortRef.current?.abort();
      setRoute(null);
      setStatus("idle");
      setRemainingMeters(0);
      setRemainingMinutes(0);
      return;
    }

    void loadRoute(driverPoint, "initial");
  }, [
    enabled,
    destination?.latitude,
    destination?.longitude,
    stage,
    refreshNonce,
    driverPoint,
    loadRoute,
  ]);

  useEffect(() => {
    if (!enabled || !driverPoint || !route?.geometry) return;

    const progress = getRouteProgress(driverPoint, route.geometry);
    const remaining = progress?.remainingMeters ?? route.distanceMeters;
    setRemainingMeters(remaining);
    setRemainingMinutes(
      estimateRemainingMinutes(
        remaining,
        route.durationSeconds,
        route.distanceMeters,
      ),
    );
  }, [
    driverPoint?.latitude,
    driverPoint?.longitude,
    enabled,
    route?.distanceMeters,
    route?.durationSeconds,
    route?.geometry,
  ]);

  useEffect(() => {
    if (!enabled || !driverPoint || !destination || !route?.geometry) return;
    if (rerouteInFlightRef.current) return;

    const needsReroute = shouldReroute(
      driverPoint,
      route.geometry,
      REROUTE_THRESHOLD_METERS,
    );

    if (!needsReroute) return;

    const now = Date.now();
    if (now - lastRerouteAtRef.current < REROUTE_COOLDOWN_MS) return;

    rerouteInFlightRef.current = true;
    void loadRoute(driverPoint, "reroute");
  }, [
    destination,
    driverPoint?.latitude,
    driverPoint?.longitude,
    enabled,
    loadRoute,
    route?.geometry,
  ]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return {
    route,
    status,
    remainingMeters,
    remainingMinutes,
    refreshRoute,
  };
}
