import AsyncStorage from "@react-native-async-storage/async-storage";
import type { NavigationStage, OrderSourceTable } from "./driverNavigation/types";

const STORAGE_KEY = "mmd_driver_trip_history_v1";
const MAX_ENTRIES = 40;

export type DriverTripHistoryEntry = {
  id: string;
  orderId: string;
  sourceTable: OrderSourceTable;
  stage: NavigationStage;
  restaurantName: string;
  pickupAddress: string;
  dropoffAddress: string;
  startedAt: string;
  endedAt: string;
  distanceTraveledMeters: number;
  routeDistanceMeters: number;
  durationSeconds: number;
};

export type TripHistorySession = {
  orderId: string;
  sourceTable: OrderSourceTable;
  stage: NavigationStage;
  restaurantName: string;
  pickupAddress: string;
  dropoffAddress: string;
  startedAt: string;
  startPoint: { latitude: number; longitude: number } | null;
  lastPoint: { latitude: number; longitude: number } | null;
  routeDistanceMeters: number;
};

function buildEntryId(orderId: string, startedAt: string): string {
  return `${orderId}:${startedAt}`;
}

export async function loadDriverTripHistory(): Promise<DriverTripHistoryEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as DriverTripHistoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function appendDriverTripHistory(
  entry: DriverTripHistoryEntry,
): Promise<void> {
  try {
    const current = await loadDriverTripHistory();
    const next = [entry, ...current.filter((item) => item.id !== entry.id)].slice(
      0,
      MAX_ENTRIES,
    );
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Non-blocking persistence
  }
}

export function createTripHistorySession(params: {
  orderId: string;
  sourceTable: OrderSourceTable;
  stage: NavigationStage;
  restaurantName: string;
  pickupAddress: string;
  dropoffAddress: string;
  routeDistanceMeters?: number;
}): TripHistorySession {
  return {
    ...params,
    startedAt: new Date().toISOString(),
    startPoint: null,
    lastPoint: null,
    routeDistanceMeters: params.routeDistanceMeters ?? 0,
  };
}

export function updateTripHistorySessionPoint(
  session: TripHistorySession,
  point: { latitude: number; longitude: number },
): TripHistorySession {
  return {
    ...session,
    startPoint: session.startPoint ?? point,
    lastPoint: point,
  };
}

export function finalizeTripHistorySession(
  session: TripHistorySession,
): DriverTripHistoryEntry {
  const endedAt = new Date().toISOString();
  const durationSeconds = Math.max(
    1,
    Math.round(
      (new Date(endedAt).getTime() - new Date(session.startedAt).getTime()) /
        1000,
    ),
  );

  let distanceTraveledMeters = 0;

  if (session.startPoint && session.lastPoint) {
    const R = 6371000;
    const lat1 = (session.startPoint.latitude * Math.PI) / 180;
    const lat2 = (session.lastPoint.latitude * Math.PI) / 180;
    const dLat = lat2 - lat1;
    const dLon =
      ((session.lastPoint.longitude - session.startPoint.longitude) * Math.PI) /
      180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    distanceTraveledMeters = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  return {
    id: buildEntryId(session.orderId, session.startedAt),
    orderId: session.orderId,
    sourceTable: session.sourceTable,
    stage: session.stage,
    restaurantName: session.restaurantName,
    pickupAddress: session.pickupAddress,
    dropoffAddress: session.dropoffAddress,
    startedAt: session.startedAt,
    endedAt,
    distanceTraveledMeters: Math.round(distanceTraveledMeters),
    routeDistanceMeters: Math.round(session.routeDistanceMeters),
    durationSeconds,
  };
}
