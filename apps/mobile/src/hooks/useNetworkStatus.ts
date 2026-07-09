import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

export type NetworkQuality = "online" | "weak" | "offline";

const WEAK_FAILURE_THRESHOLD = 2;
const RECOVERY_SUCCESS_THRESHOLD = 1;
const NETWORK_POLL_MS = 8_000;

type ExpoNetworkModule = {
  getNetworkStateAsync: () => Promise<{
    isConnected?: boolean | null;
    isInternetReachable?: boolean | null;
  }>;
};

function getExpoNetwork(): ExpoNetworkModule | null {
  try {
    // Optional dependency — keep failure-counter path if native module is missing.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("expo-network") as ExpoNetworkModule;
  } catch {
    return null;
  }
}

function qualityFromNetworkState(state: {
  isConnected?: boolean | null;
  isInternetReachable?: boolean | null;
}): NetworkQuality | null {
  const connected = state.isConnected;
  const reachable = state.isInternetReachable;
  if (connected === false) return "offline";
  if (reachable === false) return "weak";
  if (connected === true) return "online";
  return null;
}

export function useNetworkStatus() {
  const [quality, setQuality] = useState<NetworkQuality>("online");
  const failureCountRef = useRef(0);
  const successCountRef = useRef(0);
  const expoNetworkRef = useRef<ExpoNetworkModule | null>(null);

  const reportFailure = useCallback(() => {
    failureCountRef.current += 1;
    successCountRef.current = 0;

    if (failureCountRef.current >= WEAK_FAILURE_THRESHOLD) {
      setQuality((current) => (current === "offline" ? "offline" : "weak"));
    }
  }, []);

  const reportSuccess = useCallback(() => {
    successCountRef.current += 1;
    failureCountRef.current = 0;

    if (successCountRef.current >= RECOVERY_SUCCESS_THRESHOLD) {
      setQuality("online");
    }
  }, []);

  useEffect(() => {
    expoNetworkRef.current = getExpoNetwork();
    let cancelled = false;

    async function pollNetwork() {
      const mod = expoNetworkRef.current;
      if (!mod?.getNetworkStateAsync) return;
      try {
        const state = await mod.getNetworkStateAsync();
        if (cancelled) return;
        const next = qualityFromNetworkState(state);
        if (next) {
          setQuality(next);
          if (next === "online") {
            failureCountRef.current = 0;
            successCountRef.current = RECOVERY_SUCCESS_THRESHOLD;
          }
        }
      } catch {
        // Fall back to reportFailure / reportSuccess counters.
      }
    }

    void pollNetwork();
    const interval = setInterval(() => {
      void pollNetwork();
    }, NETWORK_POLL_MS);

    const onAppStateChange = (state: AppStateStatus) => {
      if (state === "active") {
        void pollNetwork();
        if (failureCountRef.current === 0 && !expoNetworkRef.current) {
          setQuality("online");
        }
      }
    };

    const subscription = AppState.addEventListener("change", onAppStateChange);
    return () => {
      cancelled = true;
      clearInterval(interval);
      subscription.remove();
    };
  }, []);

  return {
    quality,
    isWeakNetwork: quality === "weak" || quality === "offline",
    reportFailure,
    reportSuccess,
  };
}
