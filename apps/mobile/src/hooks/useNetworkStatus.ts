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
    // Never load expo-network's default entry until native ExpoNetwork is linked.
    // ExpoNetwork.js calls requireNativeModule('ExpoNetwork') at module eval.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { requireOptionalNativeModule } = require("expo-modules-core") as {
      requireOptionalNativeModule?: (name: string) => unknown;
    };
    if (typeof requireOptionalNativeModule !== "function") {
      return null;
    }
    const native = requireOptionalNativeModule("ExpoNetwork") as ExpoNetworkModule | null;
    if (!native) {
      return null;
    }
    // Native present - safe to load JS wrapper (named exports include getNetworkStateAsync).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-network") as ExpoNetworkModule & {
      default?: ExpoNetworkModule;
    };
    const api = mod.default ?? mod;
    if (api && typeof api.getNetworkStateAsync === "function") {
      return api;
    }
    if (typeof native.getNetworkStateAsync === "function") {
      return native;
    }
    return null;
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
