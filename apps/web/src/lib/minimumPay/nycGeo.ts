import { detectUsCountyFromCoordinates } from "@/lib/platformCountyInference";

export function coordinateInConfiguredCounties(
  lat: unknown,
  lng: unknown,
  eligibleCountyCodes: string[]
): boolean {
  const allowed = new Set(
    eligibleCountyCodes.map((code) => String(code ?? "").trim().toLowerCase()).filter(Boolean)
  );
  if (allowed.size === 0) return false;
  const county = detectUsCountyFromCoordinates(lat, lng);
  if (!county) return false;
  return allowed.has(county);
}

/**
 * Technical in-scope rule: pickup OR dropoff is inside Admin-configured
 * county codes. This is not a legal determination of a covered NYC trip.
 * LEGAL CONFIRMATION REQUIRED before treating this OR-rule as DCWP law.
 */
export function tripInConfiguredJurisdiction(input: {
  pickupLat: unknown;
  pickupLng: unknown;
  dropoffLat: unknown;
  dropoffLng: unknown;
  eligibleCountyCodes: string[];
}): { pickupInScope: boolean; dropoffInScope: boolean; eligible: boolean } {
  const pickupInScope = coordinateInConfiguredCounties(
    input.pickupLat,
    input.pickupLng,
    input.eligibleCountyCodes
  );
  const dropoffInScope = coordinateInConfiguredCounties(
    input.dropoffLat,
    input.dropoffLng,
    input.eligibleCountyCodes
  );
  return {
    pickupInScope,
    dropoffInScope,
    eligible: pickupInScope || dropoffInScope,
  };
}
