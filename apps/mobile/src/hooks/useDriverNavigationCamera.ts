import { useCallback, useEffect, useRef, useState } from "react";
import type Mapbox from "@rnmapbox/maps";
import { smoothHeading } from "../lib/navigationService";
import type { CoordinatePoint } from "../lib/coordinates";
import type { NavigationCameraMode } from "../lib/driverNavigation/types";

const FOLLOW_ZOOM = 17.2;
const FOLLOW_PITCH = 56;
const CAMERA_THROTTLE_MS = 800;

type UseDriverNavigationCameraParams = {
  cameraRef: React.RefObject<Mapbox.Camera | null>;
  driverPoint: CoordinatePoint | null;
  heading: number;
  navigationActive: boolean;
  enabled: boolean;
};

export function useDriverNavigationCamera(
  params: UseDriverNavigationCameraParams,
) {
  const { cameraRef, driverPoint, heading, navigationActive, enabled } = params;

  const [mode, setMode] = useState<NavigationCameraMode>("follow");
  const smoothedHeadingRef = useRef(0);
  const lastCameraAtRef = useRef(0);

  const setFreeMode = useCallback(() => {
    setMode("free");
  }, []);

  const recenter = useCallback(() => {
    if (!driverPoint || !cameraRef.current) return;

    setMode("follow");
    smoothedHeadingRef.current = navigationActive ? heading : 0;

    try {
      cameraRef.current.setCamera({
        centerCoordinate: [driverPoint.longitude, driverPoint.latitude],
        zoomLevel: navigationActive ? FOLLOW_ZOOM : 16,
        heading: navigationActive ? smoothedHeadingRef.current : 0,
        pitch: navigationActive ? FOLLOW_PITCH : 0,
        animationDuration: 650,
        animationMode: "flyTo",
      });
    } catch {
      // ignore camera errors
    }
  }, [cameraRef, driverPoint, heading, navigationActive]);

  useEffect(() => {
    if (!enabled || !driverPoint || mode !== "follow" || !cameraRef.current) {
      return;
    }

    const now = Date.now();
    if (now - lastCameraAtRef.current < CAMERA_THROTTLE_MS) {
      return;
    }

    lastCameraAtRef.current = now;
    smoothedHeadingRef.current = navigationActive
      ? smoothHeading(smoothedHeadingRef.current, heading)
      : 0;

    try {
      cameraRef.current.setCamera({
        centerCoordinate: [driverPoint.longitude, driverPoint.latitude],
        zoomLevel: navigationActive ? FOLLOW_ZOOM : 16,
        heading: navigationActive ? smoothedHeadingRef.current : 0,
        pitch: navigationActive ? FOLLOW_PITCH : 0,
        animationMode: "easeTo",
        animationDuration: 700,
      });
    } catch {
      // ignore camera errors
    }
  }, [
    cameraRef,
    driverPoint?.latitude,
    driverPoint?.longitude,
    enabled,
    heading,
    mode,
    navigationActive,
  ]);

  return {
    mode,
    setFreeMode,
    recenter,
  };
}
