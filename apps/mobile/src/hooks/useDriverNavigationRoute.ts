import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchNavigationRoutes,
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
  language?: string;
  onNetworkFailure?: () => void;
  onNetworkSuccess?: () => void;
  onReroute?: () => void;
};

export type DriverNavigationRouteState = {
  route: NavigationRoute | null;
  routes: NavigationRoute[];
  selectedRouteIndex: number;
  selectRouteIndex: (index: number) => void;
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
    language = "en",
    onNetworkFailure,
    onNetworkSuccess,
    onReroute,
  } = params;

  const [routes, setRoutes] = useState<NavigationRoute[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [status, setStatus] = useState<RouteEngineStatus>("idle");
  const [remainingMeters, setRemainingMeters] = useState(0);
  const [remainingMinutes, setRemainingMinutes] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const rerouteInFlightRef = useRef(false);
  const lastRerouteAtRef = useRef(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const routeRef = useRef<NavigationRoute | null>(null);

  const applyRoute = useCallback((nextRoutes: NavigationRoute[], index: number) => {
    const safeIndex = Math.min(Math.max(index, 0), Math.max(nextRoutes.length - 1, 0));
    const nextRoute = nextRoutes[safeIndex] ?? null;
    routeRef.current = nextRoute;
    setRoutes(nextRoutes);
    setSelectedRouteIndex(safeIndex);
    setRouteMetrics(nextRoute, driverPoint);
  }, [driverPoint]);

  function setRouteMetrics(
    nextRoute: NavigationRoute | null,
    point: CoordinatePoint | null,
  ) {
    if (!nextRoute) {
      setRemainingMeters(0);
      setRemainingMinutes(0);
      return;
    }

    const progress = point ? getRouteProgress(point, nextRoute.geometry) : null;
    const remaining = progress?.remainingMeters ?? nextRoute.distanceMeters;
    setRemainingMeters(remaining);
    setRemainingMinutes(
      estimateRemainingMinutes(
        remaining,
        nextRoute.durationSeconds,
        nextRoute.distanceMeters,
      ),
    );
  }

  const loadRoutes = useCallback(
    async (origin: CoordinatePoint, reason: "initial" | "reroute" | "manual") => {
      if (!destination) {
        applyRoute([], 0);
        setStatus("idle");
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      if (reason !== "reroute") {
        setStatus("loading");
      }

      try {
        const nextRoutes = await fetchNavigationRoutes(
          origin,
          destination,
          [],
          controller.signal,
          { language, alternatives: true },
        );

        if (controller.signal.aborted) return;

        if (!nextRoutes.length) {
          setStatus(routeRef.current ? "stale" : "error");
          onNetworkFailure?.();
          return;
        }

        applyRoute(nextRoutes, reason === "reroute" ? 0 : selectedRouteIndex);
        setStatus("ready");
        lastRerouteAtRef.current = Date.now();
        onNetworkSuccess?.();
        if (reason === "reroute") {
          onReroute?.();
        }
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
    [
      applyRoute,
      destination,
      language,
      onNetworkFailure,
      onNetworkSuccess,
      onReroute,
      selectedRouteIndex,
    ],
  );

  const refreshRoute = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

  const selectRouteIndex = useCallback(
    (index: number) => {
      applyRoute(routes, index);
    },
    [applyRoute, routes],
  );

  useEffect(() => {
    routeRef.current = routes[selectedRouteIndex] ?? null;
  }, [routes, selectedRouteIndex]);

  useEffect(() => {
    if (!enabled || !driverPoint || !destination) {
      abortRef.current?.abort();
      applyRoute([], 0);
      setStatus("idle");
      return;
    }

    void loadRoutes(driverPoint, "initial");
  }, [
    enabled,
    destination?.latitude,
    destination?.longitude,
    stage,
    refreshNonce,
    driverPoint,
    loadRoutes,
    applyRoute,
  ]);

  useEffect(() => {
    const route = routes[selectedRouteIndex];
    if (!enabled || !driverPoint || !route?.geometry) return;

    setRouteMetrics(route, driverPoint);
  }, [
    driverPoint?.latitude,
    driverPoint?.longitude,
    enabled,
    routes,
    selectedRouteIndex,
  ]);

  useEffect(() => {
    const route = routes[selectedRouteIndex];
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
    void loadRoutes(driverPoint, "reroute");
  }, [
    destination,
    driverPoint?.latitude,
    driverPoint?.longitude,
    enabled,
    loadRoutes,
    routes,
    selectedRouteIndex,
  ]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  return {
    route: routes[selectedRouteIndex] ?? null,
    routes,
    selectedRouteIndex,
    selectRouteIndex,
    status,
    remainingMeters,
    remainingMinutes,
    refreshRoute,
  };
}
