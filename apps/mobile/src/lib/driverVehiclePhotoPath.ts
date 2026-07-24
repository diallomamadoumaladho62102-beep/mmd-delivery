/** Durable avatars-bucket object path for a driver vehicle primary photo. */
export function vehiclePhotoStoragePath(
  driverUserId: string,
  vehicleId: string,
): string {
  return `drivers/${driverUserId}/vehicles/${vehicleId}/primary.jpg`;
}
