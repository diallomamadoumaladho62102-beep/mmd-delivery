export const TAXI_FAVORITE_DISPATCH_TIMEOUT_SECONDS = Math.min(
  Math.max(
    Number(process.env.TAXI_FAVORITE_DISPATCH_TIMEOUT_SECONDS ?? 120),
    30
  ),
  600
);

export function resolveInitialTaxiDispatchWave(ride: {
  preferred_driver_id?: unknown;
}): number {
  const preferred = String(ride.preferred_driver_id ?? "").trim();
  return preferred ? 0 : 1;
}
