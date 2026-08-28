import * as Location from "expo-location";

/**
 * Read last-known coordinates only if foreground permission is already granted.
 * Never requests a permission and never touches background location.
 */
export async function getAlreadyGrantedClientCoords(): Promise<{
  latitude: number;
  longitude: number;
} | null> {
  try {
    const current = await Location.getForegroundPermissionsAsync();
    if (current.status !== Location.PermissionStatus.GRANTED) return null;
    const last = await Location.getLastKnownPositionAsync();
    const latitude = last?.coords.latitude;
    const longitude = last?.coords.longitude;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    if (Math.abs(Number(latitude)) < 0.000001 && Math.abs(Number(longitude)) < 0.000001) {
      return null;
    }
    return { latitude: Number(latitude), longitude: Number(longitude) };
  } catch {
    return null;
  }
}
