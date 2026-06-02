import { useEffect, useRef, useState } from "react";
import { distanceMeters } from "../lib/coordinates";
import type { CoordinatePoint } from "../lib/coordinates";
import type { NavigationStage } from "../lib/driverNavigation/types";

const PICKUP_RADIUS_METERS = 80;
const DROPOFF_RADIUS_METERS = 90;
const PICKUP_EXIT_RADIUS_METERS = 120;
const DROPOFF_EXIT_RADIUS_METERS = 130;

export type ArrivalState = {
  pickupArrived: boolean;
  dropoffArrived: boolean;
};

type UseArrivalGeofenceParams = {
  enabled: boolean;
  driverPoint: CoordinatePoint | null;
  stage: NavigationStage;
  pickup: CoordinatePoint | null;
  dropoff: CoordinatePoint | null;
};

export function useArrivalGeofence(
  params: UseArrivalGeofenceParams,
): ArrivalState {
  const { enabled, driverPoint, stage, pickup, dropoff } = params;
  const [pickupArrived, setPickupArrived] = useState(false);
  const [dropoffArrived, setDropoffArrived] = useState(false);
  const pickupArrivedRef = useRef(false);
  const dropoffArrivedRef = useRef(false);

  useEffect(() => {
    pickupArrivedRef.current = false;
    dropoffArrivedRef.current = false;
    setPickupArrived(false);
    setDropoffArrived(false);
  }, [pickup?.latitude, pickup?.longitude, dropoff?.latitude, dropoff?.longitude, stage]);

  useEffect(() => {
    if (!enabled || !driverPoint) return;

    if (stage === "pickup" && pickup) {
      const distance = distanceMeters(
        driverPoint.latitude,
        driverPoint.longitude,
        pickup.latitude,
        pickup.longitude,
      );

      if (!pickupArrivedRef.current && distance <= PICKUP_RADIUS_METERS) {
        pickupArrivedRef.current = true;
        setPickupArrived(true);
      } else if (
        pickupArrivedRef.current &&
        distance > PICKUP_EXIT_RADIUS_METERS
      ) {
        pickupArrivedRef.current = false;
        setPickupArrived(false);
      }
    }

    if (stage === "dropoff" && dropoff) {
      const distance = distanceMeters(
        driverPoint.latitude,
        driverPoint.longitude,
        dropoff.latitude,
        dropoff.longitude,
      );

      if (!dropoffArrivedRef.current && distance <= DROPOFF_RADIUS_METERS) {
        dropoffArrivedRef.current = true;
        setDropoffArrived(true);
      } else if (
        dropoffArrivedRef.current &&
        distance > DROPOFF_EXIT_RADIUS_METERS
      ) {
        dropoffArrivedRef.current = false;
        setDropoffArrived(false);
      }
    }
  }, [
    driverPoint?.latitude,
    driverPoint?.longitude,
    dropoff,
    enabled,
    pickup,
    stage,
  ]);

  return { pickupArrived, dropoffArrived };
}
