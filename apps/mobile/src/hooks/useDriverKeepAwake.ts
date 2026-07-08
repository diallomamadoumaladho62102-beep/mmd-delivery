import { useEffect } from "react";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

const DRIVER_KEEP_AWAKE_TAG = "mmd-driver-active";

export function useDriverKeepAwake(active: boolean) {
  useEffect(() => {
    if (!active) {
      deactivateKeepAwake(DRIVER_KEEP_AWAKE_TAG);
      return;
    }

    void activateKeepAwakeAsync(DRIVER_KEEP_AWAKE_TAG);

    return () => {
      deactivateKeepAwake(DRIVER_KEEP_AWAKE_TAG);
    };
  }, [active]);
}
