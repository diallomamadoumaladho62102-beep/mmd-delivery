export type NearbyMapDriver = {
  markerId: string;
  latitude: number;
  longitude: number;
};

export type NearbyEtaState = {
  available: boolean;
  minutes: number | null;
};

const DRIVER_KEYS = new Set(["marker_id", "latitude", "longitude"]);

export function sanitizeNearbyDrivers(value: unknown): NearbyMapDriver[] {
  if (!Array.isArray(value)) return [];
  const drivers: NearbyMapDriver[] = [];
  for (const row of value) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    if (Object.keys(record).some((key) => !DRIVER_KEYS.has(key))) continue;
    const latitude = Number(record.latitude);
    const longitude = Number(record.longitude);
    const markerId = String(record.marker_id ?? "");
    if (!markerId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    drivers.push({ markerId, latitude, longitude });
  }
  return drivers;
}

export function sanitizeNearbyEta(value: unknown): NearbyEtaState {
  if (!value || typeof value !== "object") return { available: false, minutes: null };
  const record = value as Record<string, unknown>;
  const minutes = Number(record.minutes);
  if (record.available === true && Number.isFinite(minutes) && minutes >= 0 && minutes <= 180) {
    return { available: true, minutes: Math.round(minutes) };
  }
  return { available: false, minutes: null };
}
