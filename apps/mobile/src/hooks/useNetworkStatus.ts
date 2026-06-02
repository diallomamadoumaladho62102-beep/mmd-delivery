import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, type AppStateStatus } from "react-native";

export type NetworkQuality = "online" | "weak" | "offline";

const WEAK_FAILURE_THRESHOLD = 2;
const RECOVERY_SUCCESS_THRESHOLD = 1;

export function useNetworkStatus() {
  const [quality, setQuality] = useState<NetworkQuality>("online");
  const failureCountRef = useRef(0);
  const successCountRef = useRef(0);

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
    const onAppStateChange = (state: AppStateStatus) => {
      if (state === "active" && failureCountRef.current === 0) {
        setQuality("online");
      }
    };

    const subscription = AppState.addEventListener("change", onAppStateChange);
    return () => subscription.remove();
  }, []);

  return {
    quality,
    isWeakNetwork: quality === "weak" || quality === "offline",
    reportFailure,
    reportSuccess,
  };
}
