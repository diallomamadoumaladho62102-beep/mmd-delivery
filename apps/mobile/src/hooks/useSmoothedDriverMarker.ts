import React, { useEffect, useRef, useState } from "react";
import type { CoordinatePoint } from "../lib/coordinates";
import { bearingDegrees } from "../lib/customerTrackingStatus";

type Smoothed = {
  latitude: number;
  longitude: number;
  headingDeg: number | null;
  moving: boolean;
};

/**
 * Keeps a stable driver pin + derived heading between GPS samples.
 * Does not invent GPS — only interpolates presentation between real points.
 */
export function useSmoothedDriverMarker(
  driver: CoordinatePoint | null,
): Smoothed | null {
  const prevRef = useRef<CoordinatePoint | null>(null);
  const [smoothed, setSmoothed] = useState<Smoothed | null>(null);

  useEffect(() => {
    if (!driver) {
      prevRef.current = null;
      setSmoothed(null);
      return;
    }

    const prev = prevRef.current;
    let heading: number | null = null;
    let moving = false;
    if (prev) {
      const dLat = Math.abs(driver.latitude - prev.latitude);
      const dLng = Math.abs(driver.longitude - prev.longitude);
      moving = dLat > 0.00001 || dLng > 0.00001;
      if (moving) {
        heading = bearingDegrees(
          prev.latitude,
          prev.longitude,
          driver.latitude,
          driver.longitude,
        );
      }
    }

    prevRef.current = driver;
    setSmoothed((current) => ({
      latitude: driver.latitude,
      longitude: driver.longitude,
      headingDeg: heading ?? current?.headingDeg ?? null,
      moving,
    }));
  }, [driver?.latitude, driver?.longitude]);

  return smoothed;
}
