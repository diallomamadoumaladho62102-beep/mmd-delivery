import { useEffect, useRef, useState } from "react";
import type { CoordinatePoint } from "../lib/coordinates";
import { distanceMeters } from "../lib/coordinates";

const DEFAULT_MIN_MOVE_METERS = 5;

export function useSmoothedDriverPoint(
  point: CoordinatePoint | null,
  minMoveMeters = DEFAULT_MIN_MOVE_METERS,
): CoordinatePoint | null {
  const [smoothed, setSmoothed] = useState<CoordinatePoint | null>(point);
  const lastAppliedRef = useRef<CoordinatePoint | null>(point);

  useEffect(() => {
    if (!point) {
      lastAppliedRef.current = null;
      setSmoothed(null);
      return;
    }

    const previous = lastAppliedRef.current;
    if (!previous) {
      lastAppliedRef.current = point;
      setSmoothed(point);
      return;
    }

    const moved = distanceMeters(
      previous.latitude,
      previous.longitude,
      point.latitude,
      point.longitude,
    );

    if (moved < minMoveMeters) {
      return;
    }

    lastAppliedRef.current = point;
    setSmoothed(point);
  }, [minMoveMeters, point?.latitude, point?.longitude]);

  return smoothed;
}
