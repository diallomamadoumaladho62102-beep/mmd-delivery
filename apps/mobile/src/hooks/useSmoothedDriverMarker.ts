import { useEffect, useRef, useState } from "react";
import type { CoordinatePoint } from "../lib/coordinates";
import { distanceMeters } from "../lib/coordinates";
import { bearingDegrees } from "../lib/customerTrackingStatus";
import {
  estimateMarkerAnimationDurationMs,
  interpolateAngle,
  interpolateCoordinate,
} from "../lib/markerAnimation";

type Smoothed = {
  latitude: number;
  longitude: number;
  headingDeg: number | null;
  moving: boolean;
};

type SmoothedDriverMarkerOptions = {
  /** Device/GPS heading when available (degrees from north). */
  headingDeg?: number | null;
  /** Reported speed in m/s — drives animation duration. */
  speedMps?: number | null;
  /** Hold last position when GPS briefly drops (ms). */
  holdMs?: number;
};

const DEFAULT_HOLD_MS = 15_000;

/**
 * Smooth driver pin between real GPS samples — interpolates position and
 * heading on the shortest arc. Never teleports; holds last fix on brief loss.
 */
export function useSmoothedDriverMarker(
  driver: CoordinatePoint | null,
  options?: SmoothedDriverMarkerOptions,
): Smoothed | null {
  const holdMs = options?.holdMs ?? DEFAULT_HOLD_MS;
  const [smoothed, setSmoothed] = useState<Smoothed | null>(null);
  const displayedRef = useRef<CoordinatePoint | null>(null);
  const headingRef = useRef<number | null>(null);
  const animRef = useRef<number | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetReceivedAtRef = useRef<number>(0);

  useEffect(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    if (!driver) {
      holdTimerRef.current = setTimeout(() => {
        if (animRef.current != null) {
          cancelAnimationFrame(animRef.current);
          animRef.current = null;
        }
        displayedRef.current = null;
        headingRef.current = null;
        setSmoothed(null);
      }, holdMs);
      return () => {
        if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      };
    }

    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }

    const now = Date.now();
    const sampleAgeMs =
      targetReceivedAtRef.current > 0 ? now - targetReceivedAtRef.current : undefined;
    targetReceivedAtRef.current = now;

    const from = displayedRef.current ?? driver;
    const dist = distanceMeters(
      from.latitude,
      from.longitude,
      driver.latitude,
      driver.longitude,
    );

    let targetHeading = options?.headingDeg ?? null;
    if (
      (targetHeading == null || !Number.isFinite(targetHeading)) &&
      displayedRef.current &&
      dist > 1
    ) {
      targetHeading = bearingDegrees(
        from.latitude,
        from.longitude,
        driver.latitude,
        driver.longitude,
      );
    }
    if (targetHeading == null || !Number.isFinite(targetHeading)) {
      targetHeading = headingRef.current;
    }

    const durationMs = estimateMarkerAnimationDurationMs({
      from,
      to: driver,
      speedMps: options?.speedMps,
      sampleAgeMs,
    });

    if (animRef.current != null) {
      cancelAnimationFrame(animRef.current);
      animRef.current = null;
    }

    const startHeading = headingRef.current ?? targetHeading ?? 0;
    const endHeading = targetHeading ?? startHeading;
    const startAt = performance.now();
    const moving = dist > 1;

    const tick = (frameNow: number) => {
      const elapsed = frameNow - startAt;
      const progress =
        durationMs <= 0 ? 1 : Math.min(1, elapsed / durationMs);
      const point = interpolateCoordinate(from, driver, progress);
      const heading =
        targetHeading != null
          ? interpolateAngle(startHeading, endHeading, progress)
          : headingRef.current;

      displayedRef.current = point;
      if (heading != null && Number.isFinite(heading)) {
        headingRef.current = heading;
      }

      setSmoothed({
        latitude: point.latitude,
        longitude: point.longitude,
        headingDeg: headingRef.current,
        moving: moving && progress < 1 ? true : dist > 1,
      });

      if (progress < 1) {
        animRef.current = requestAnimationFrame(tick);
      } else {
        animRef.current = null;
        displayedRef.current = driver;
      }
    };

    if (durationMs <= 0 || dist < 0.5) {
      displayedRef.current = driver;
      if (targetHeading != null && Number.isFinite(targetHeading)) {
        headingRef.current = targetHeading;
      }
      setSmoothed({
        latitude: driver.latitude,
        longitude: driver.longitude,
        headingDeg: headingRef.current,
        moving: dist > 1,
      });
      return () => {
        if (animRef.current != null) cancelAnimationFrame(animRef.current);
      };
    }

    animRef.current = requestAnimationFrame(tick);
    return () => {
      if (animRef.current != null) cancelAnimationFrame(animRef.current);
    };
  }, [
    driver?.latitude,
    driver?.longitude,
    options?.headingDeg,
    options?.speedMps,
    holdMs,
  ]);

  return smoothed;
}
