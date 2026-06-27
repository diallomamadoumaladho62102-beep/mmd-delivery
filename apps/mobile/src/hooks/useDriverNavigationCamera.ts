import { useCallback, useEffect, useRef, useState } from "react";
import type Mapbox from "@rnmapbox/maps";
import { smoothHeading } from "../lib/navigationService";
import type { CoordinatePoint } from "../lib/coordinates";
import type { NavigationCameraMode } from "../lib/driverNavigation/types";
import { NAV_CAMERA, NAV_CAMERA_LOOK_AHEAD_METERS } from "../lib/driverNavigationVisual";
import {
  computeAdaptiveCameraSettings,
  pointOffsetByBearing,
} from "../lib/driverNavigationCameraMath";
import { useNavigationScreenLayout } from "./useNavigationScreenLayout";

const CAMERA_THROTTLE_MS = 16;
const HEADING_SMOOTH_FACTOR = 0.72;
const ZOOM_SMOOTH_FACTOR = 0.48;
const FOLLOW_ANIMATION_MS = 100;

type UseDriverNavigationCameraParams = {
  cameraRef: React.RefObject<Mapbox.Camera | null>;
  driverPoint: CoordinatePoint | null;
  heading: number;
  routeBearing: number | null;
  maneuverDistanceMeters: number | null;
  speedMps: number | null;
  navigationActive: boolean;
  enabled: boolean;
};

export function useDriverNavigationCamera(
  params: UseDriverNavigationCameraParams,
) {
  const {
    cameraRef,
    driverPoint,
    heading,
    routeBearing,
    maneuverDistanceMeters,
    speedMps,
    navigationActive,
    enabled,
  } = params;

  const screenLayout = useNavigationScreenLayout();
  const [mode, setMode] = useState<NavigationCameraMode>("follow");
  const smoothedHeadingRef = useRef(0);
  const lastCameraAtRef = useRef(0);
  const lastZoomRef = useRef(NAV_CAMERA.zoom);
  const lastPitchRef = useRef(NAV_CAMERA.pitch);

  const setFreeMode = useCallback(() => {
    setMode("free");
  }, []);

  const setFollowMode = useCallback(() => {
    setMode("follow");
  }, []);

  const targetHeading =
    navigationActive && routeBearing != null ? routeBearing : heading;

  const applyFollowCamera = useCallback(
    (animationDuration = FOLLOW_ANIMATION_MS) => {
      if (!driverPoint || !cameraRef.current) return;

      const adaptive = computeAdaptiveCameraSettings({
        maneuverDistanceMeters,
        speedMps,
        paddingTop: screenLayout.cameraPaddingTop,
        paddingBottom: screenLayout.cameraPaddingBottom,
      });

      lastZoomRef.current +=
        (adaptive.zoom - lastZoomRef.current) * ZOOM_SMOOTH_FACTOR;
      lastPitchRef.current +=
        (adaptive.pitch - lastPitchRef.current) * ZOOM_SMOOTH_FACTOR;

      const center =
        navigationActive && Number.isFinite(smoothedHeadingRef.current)
          ? pointOffsetByBearing(
              driverPoint,
              smoothedHeadingRef.current,
              NAV_CAMERA_LOOK_AHEAD_METERS,
            )
          : driverPoint;

      try {
        cameraRef.current.setCamera({
          centerCoordinate: [center.longitude, center.latitude],
          zoomLevel: navigationActive ? lastZoomRef.current : 16,
          heading: navigationActive ? smoothedHeadingRef.current : 0,
          pitch: navigationActive ? lastPitchRef.current : 0,
          padding: navigationActive
            ? {
                paddingTop: adaptive.paddingTop,
                paddingBottom: adaptive.paddingBottom,
                paddingLeft: screenLayout.cameraPaddingLeft,
                paddingRight: screenLayout.cameraPaddingRight,
              }
            : undefined,
          animationDuration,
          animationMode: animationDuration > 0 ? "linearTo" : "none",
        });
      } catch {
        // ignore camera errors
      }
    },
    [
      cameraRef,
      driverPoint,
      maneuverDistanceMeters,
      navigationActive,
      screenLayout.cameraPaddingBottom,
      screenLayout.cameraPaddingLeft,
      screenLayout.cameraPaddingRight,
      screenLayout.cameraPaddingTop,
      speedMps,
    ],
  );

  const recenter = useCallback(() => {
    if (!driverPoint || !cameraRef.current) return;

    setMode("follow");
    smoothedHeadingRef.current = navigationActive ? targetHeading : 0;
    lastZoomRef.current = NAV_CAMERA.zoom;
    lastPitchRef.current = NAV_CAMERA.pitch;
    applyFollowCamera(320);
  }, [applyFollowCamera, driverPoint, navigationActive, targetHeading]);

  useEffect(() => {
    if (!enabled || !driverPoint || mode !== "follow" || !cameraRef.current) {
      return;
    }

    const now = Date.now();
    const isFirstFix = lastCameraAtRef.current === 0;
    if (!isFirstFix && now - lastCameraAtRef.current < CAMERA_THROTTLE_MS) {
      return;
    }

    lastCameraAtRef.current = now;
    smoothedHeadingRef.current = navigationActive
      ? isFirstFix
        ? targetHeading
        : smoothHeading(
            smoothedHeadingRef.current,
            targetHeading,
            HEADING_SMOOTH_FACTOR,
          )
      : 0;

    applyFollowCamera(isFirstFix ? 0 : FOLLOW_ANIMATION_MS);
  }, [
    applyFollowCamera,
    cameraRef,
    driverPoint?.latitude,
    driverPoint?.longitude,
    enabled,
    maneuverDistanceMeters,
    mode,
    navigationActive,
    screenLayout.cameraPaddingBottom,
    screenLayout.cameraPaddingTop,
    screenLayout.height,
    screenLayout.width,
    speedMps,
    targetHeading,
  ]);

  return {
    mode,
    setFreeMode,
    setFollowMode,
    recenter,
    screenLayout,
  };
}
