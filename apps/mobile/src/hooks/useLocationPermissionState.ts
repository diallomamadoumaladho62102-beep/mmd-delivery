import { useCallback, useEffect, useState } from "react";
import {
  getFreshPosition,
  getLocationPermissionState,
  openLocationSettings,
  requestLocationPermission,
  type FreshPositionResult,
  type LocationPermissionState,
} from "../lib/locationPermissionState";

export function useLocationPermissionState() {
  const [state, setState] = useState<LocationPermissionState>("undetermined");
  const [freshPosition, setFreshPosition] = useState<FreshPositionResult | null>(
    null
  );
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const next = await getLocationPermissionState();
    setState(next);
    return next;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const request = useCallback(async () => {
    setLoading(true);
    try {
      const next = await requestLocationPermission();
      setState(next);
      return next;
    } finally {
      setLoading(false);
    }
  }, []);

  const openSettings = useCallback(async () => {
    await openLocationSettings();
  }, []);

  const requestFreshPosition = useCallback(
    async (opts?: { timeoutMs?: number }) => {
      setLoading(true);
      try {
        const result = await getFreshPosition(opts);
        setFreshPosition(result);
        if (
          result.state === "fresh" ||
          result.state === "cached" ||
          result.state === "weak_accuracy"
        ) {
          setState(result.state);
        } else if (
          result.state === "denied" ||
          result.state === "blocked" ||
          result.state === "services_off" ||
          result.state === "unavailable" ||
          result.state === "timeout"
        ) {
          setState(result.state);
        }
        return result;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return {
    state,
    loading,
    freshPosition,
    refresh,
    request,
    openSettings,
    requestFreshPosition,
  };
}
