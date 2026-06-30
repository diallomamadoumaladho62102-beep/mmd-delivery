import type { CoordinatePoint } from "../coordinates";

export type NavigationStage = "pickup" | "dropoff";

export type OrderSourceTable =
  | "orders"
  | "delivery_requests"
  | "taxi_rides"
  | "marketplace_delivery_jobs";

export type GpsQualityStatus = "initializing" | "active" | "degraded" | "lost";

export type RouteEngineStatus =
  | "idle"
  | "loading"
  | "ready"
  | "rerouting"
  | "error"
  | "stale";

export type NavigationTrip = {
  orderId: string;
  sourceTable: OrderSourceTable;
  restaurantName: string;
  pickupAddress: string;
  dropoffAddress: string;
  pickup: CoordinatePoint | null;
  dropoff: CoordinatePoint | null;
  stage: NavigationStage;
  price: number;
  distanceMiles: number;
  etaMinutes: number;
  /** ISO country code when present on the loaded order row. */
  orderCountryCode?: string | null;
  pickupLocationId?: string | null;
  dropoffLocationId?: string | null;
};

export type NavigationCameraMode = "follow" | "free";
