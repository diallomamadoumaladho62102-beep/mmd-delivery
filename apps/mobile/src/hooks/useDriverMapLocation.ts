import { useCallback, useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import { calculateHeading } from "../lib/navigationService";
import type { CoordinatePoint } from "../lib/coordinates";
import type { GpsQualityStatus } from "../lib/driverNavigation/types";

const GPS_LOST_TIMEOUT_MS = 28_000;
const GPS_DEGRADED_ACCURACY_METERS = 100;
const GPS_STALE_ACCURACY_METERS = 160;
const MIN_HEADING_DISTANCE_METERS = 4;

export type DriverMapLocationState = {
  point: CoordinatePoint | null;
  heading: number;
  accuracyMeters: number | null;
  speedMps: number | null;
  gpsStatus: GpsQualityStatus;
  permissionStatus: Location.PermissionStatus | "undetermined";
  lastUpdatedAt: number | null;
  errorMessage: string | null;
  isReady: boolean;
};

export function useDriverMapLocation(enabled = true): DriverMapLocationState {
  const [point, setPoint] = useState<CoordinatePoint | null>(null);
  const [heading, setHeading] = useState(0);
  const [accuracyMeters, setAccuracyMeters] = useState<number | null>(null);
  const [speedMps, setSpeedMps] = useState<number | null>(null);
  const [gpsStatus, setGpsStatus] = useState<GpsQualityStatus>("initializing");
  const [permissionStatus, setPermissionStatus] =
    useState<Location.PermissionStatus | "undetermined">("undetermined");
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const previousPointRef = useRef<CoordinatePoint | null>(null);
  const mountedRef = useRef(true);

  const applyPosition = useCallback((pos: Location.LocationObject) => {
    const latitude = pos.coords.latitude;
    const longitude = pos.coords.longitude;

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }

    const nextPoint = { latitude, longitude };
    const now = Date.now();
    const accuracy = Number.isFinite(pos.coords.accuracy)
      ? Number(pos.coords.accuracy)
      : null;
    const speed = Number.isFinite(pos.coords.speed)
      ? Math.max(0, Number(pos.coords.speed))
      : null;

    setPoint(nextPoint);
    setAccuracyMeters(accuracy);
    setSpeedMps(speed);
    setLastUpdatedAt(now);
    setIsReady(true);
    setErrorMessage(null);

    if (accuracy != null && accuracy > GPS_STALE_ACCURACY_METERS) {
      setGpsStatus("degraded");
    } else if (accuracy != null && accuracy > GPS_DEGRADED_ACCURACY_METERS) {
      setGpsStatus("degraded");
    } else {
      setGpsStatus("active");
    }

    const nativeHeading = Number(pos.coords.heading);
    if (Number.isFinite(nativeHeading) && nativeHeading >= 0) {
      setHeading(nativeHeading);
    } else {
      const previousPoint = previousPointRef.current;
      if (previousPoint) {
        const movedMeters = Math.hypot(
          nextPoint.latitude - previousPoint.latitude,
          nextPoint.longitude - previousPoint.longitude,
        );

        if (movedMeters * 111_000 >= MIN_HEADING_DISTANCE_METERS) {
          setHeading(calculateHeading(previousPoint, nextPoint));
        }
      }
    }

    previousPointRef.current = nextPoint;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    async function startTracking() {
      try {
        setGpsStatus("initializing");
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled || !mountedRef.current) return;

        setPermissionStatus(status);
        if (status !== "granted") {
          setErrorMessage("Permission GPS refusée.");
          setGpsStatus("lost");
          return;
        }

        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.BestForNavigation,
        });

        if (cancelled || !mountedRef.current) return;
        applyPosition(current);

        subscriptionRef.current?.remove();
        subscriptionRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 2000,
            distanceInterval: 8,
          },
          (pos) => {
            if (!mountedRef.current) return;
            applyPosition(pos);
          },
        );
      } catch (error) {
        if (!mountedRef.current) return;
        setErrorMessage(
          error instanceof Error ? error.message : "Impossible d'activer le GPS.",
        );
        setGpsStatus("lost");
      }
    }

    void startTracking();

    return () => {
      cancelled = true;
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
    };
  }, [applyPosition, enabled]);

  useEffect(() => {
    if (!enabled || !lastUpdatedAt) return;

    const timer = setInterval(() => {
      if (Date.now() - lastUpdatedAt > GPS_LOST_TIMEOUT_MS) {
        setGpsStatus("lost");
      }
    }, 3000);

    return () => clearInterval(timer);
  }, [enabled, lastUpdatedAt]);

  return {
    point,
    heading,
    accuracyMeters,
    speedMps,
    gpsStatus,
    permissionStatus,
    lastUpdatedAt,
    errorMessage,
    isReady,
  };
}
