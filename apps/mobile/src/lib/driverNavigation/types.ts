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
  /** Raw order country_code when present on the loaded row. */
  orderCountryCode?: unknown;
  pickupLocationId?: string | null;
  dropoffLocationId?: string | null;
};

export type NavigationCameraMode = "follow" | "free";
