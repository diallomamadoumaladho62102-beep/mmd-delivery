import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";
import type { CoordinatePoint } from "../lib/coordinates";
import {
  createLiveEtaSession,
  fetchLiveEta,
  type LiveEtaResult,
} from "../lib/mapboxLiveEta";
import { useNetworkStatus } from "./useNetworkStatus";

export type UseLiveTripEtaParams = {
  from?: CoordinatePoint | null;
  to?: CoordinatePoint | null;
  /** Refresh interval when app is active (ms). Default 12s. */
  intervalMs?: number;
  enabled?: boolean;
};

export function useLiveTripEta(params: UseLiveTripEtaParams) {
  const { from, to, intervalMs = 12_000, enabled = true } = params;
  const network = useNetworkStatus();
  const [eta, setEta] = useState<LiveEtaResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [stale, setStale] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const sessionRef = useRef(createLiveEtaSession());
  const abortRef = useRef<AbortController | null>(null);
  const reportSuccessRef = useRef(network.reportSuccess);
  const reportFailureRef = useRef(network.reportFailure);
  reportSuccessRef.current = network.reportSuccess;
  reportFailureRef.current = network.reportFailure;

  const fromLat = from?.latitude;
  const fromLng = from?.longitude;
  const toLat = to?.latitude;
  const toLng = to?.longitude;
  const networkQuality = network.quality;
  const isWeakNetwork = network.isWeakNetwork;

  const refresh = useCallback(async () => {
    if (
      !enabled ||
      fromLat == null ||
      fromLng == null ||
      toLat == null ||
      toLng == null
    ) {
      setEta(null);
      return;
    }
    if (networkQuality === "offline") {
      setStale(true);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const gen = sessionRef.current.nextGeneration();

    setLoading(true);
    try {
      const result = await fetchLiveEta({
        from: { latitude: fromLat, longitude: fromLng },
        to: { latitude: toLat, longitude: toLng },
        signal: controller.signal,
      });
      if (!sessionRef.current.isCurrent(gen)) return;
      setEta(result);
      setUpdatedAt(Date.now());
      setStale(result.source === "haversine" && isWeakNetwork);
      reportSuccessRef.current();
    } catch {
      if (!sessionRef.current.isCurrent(gen)) return;
      setStale(true);
      reportFailureRef.current();
    } finally {
      if (sessionRef.current.isCurrent(gen)) {
        setLoading(false);
      }
    }
  }, [
    enabled,
    fromLat,
    fromLng,
    toLat,
    toLng,
    networkQuality,
    isWeakNetwork,
  ]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => {
      if (AppState.currentState === "active") {
        void refresh();
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs, refresh]);

  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === "active") {
        void refresh();
      }
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [refresh]);

  // Reconnect when network recovers
  const prevQuality = useRef(networkQuality);
  useEffect(() => {
    if (
      prevQuality.current !== "online" &&
      networkQuality === "online" &&
      enabled
    ) {
      void refresh();
    }
    prevQuality.current = networkQuality;
  }, [networkQuality, enabled, refresh]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      sessionRef.current.nextGeneration();
    };
  }, []);

  return {
    eta,
    loading,
    stale,
    offline: networkQuality === "offline",
    weakNetwork: isWeakNetwork,
    updatedAt,
    refresh,
    networkQuality,
  };
}
