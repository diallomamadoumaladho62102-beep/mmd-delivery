import type { TaxiCategory } from "./driverServicePreferencesTypes";

export function normalizeTaxiRideCategory(value: string | null | undefined): TaxiCategory {
  const v = String(value ?? "standard").trim().toLowerCase();
  if (v === "premium" || v === "comfort") return "comfort";
  if (v === "xl") return "xl";
  if (v === "wheelchair" || v === "wheelchair_accessible") return "wheelchair_accessible";
  return "standard";
}

export function vehicleCategoryEligible(
  eligibleCategories: Set<string>,
  category: TaxiCategory,
): boolean {
  return eligibleCategories.has(category);
}

/**
 * Determines whether a driver's active vehicle can serve a requested ride class.
 * Higher tiers may serve Standard only when acceptAlsoStandard is enabled.
 */
export function driverMatchesTaxiRideCategory(params: {
  rideClass: string;
  eligibleCategories: string[];
  acceptAlsoStandard: boolean;
}): boolean {
  const rideClass = normalizeTaxiRideCategory(params.rideClass);
  const eligible = new Set(params.eligibleCategories.map((c) => normalizeTaxiRideCategory(c)));

  if (rideClass === "standard") {
    if (vehicleCategoryEligible(eligible, "standard")) return true;
    if (!params.acceptAlsoStandard) return false;
    return (
      vehicleCategoryEligible(eligible, "comfort") ||
      vehicleCategoryEligible(eligible, "xl") ||
      vehicleCategoryEligible(eligible, "wheelchair_accessible")
    );
  }

  if (rideClass === "comfort") return vehicleCategoryEligible(eligible, "comfort");
  if (rideClass === "xl") return vehicleCategoryEligible(eligible, "xl");
  return vehicleCategoryEligible(eligible, "wheelchair_accessible");
}

export function taxiFuelTypeIsGreen(fuelType: string | null | undefined): boolean {
  const v = String(fuelType ?? "").trim().toLowerCase();
  return v === "electric" || v === "hybrid" || v === "plug_in_hybrid";
}

export type TaxiAcceptRejectReason =
  | "not_authenticated"
  | "offer_not_found"
  | "ride_not_found"
  | "offer_not_available"
  | "identity_not_verified"
  | "account_inactive"
  | "driver_not_operational"
  | "driver_offline"
  | "driver_unavailable"
  | "taxi_service_disabled"
  | "no_active_vehicle"
  | "vehicle_documents_invalid"
  | "category_not_eligible"
  | "electric_required"
  | "ride_not_paid"
  | "already_assigned"
  | "ride_not_available"
  | "validation_failed";

export const TAXI_ACCEPT_REASON_MESSAGES: Record<TaxiAcceptRejectReason, string> = {
  not_authenticated: "Authentification requise.",
  offer_not_found: "Offre introuvable.",
  ride_not_found: "Course introuvable.",
  offer_not_available: "Offre expirée ou indisponible.",
  identity_not_verified: "Vérification d'identité requise.",
  account_inactive: "Compte inactif.",
  driver_not_operational: "Compte chauffeur non approuvé.",
  driver_offline: "Vous devez être en ligne pour accepter.",
  driver_unavailable: "Vous avez déjà une course active.",
  taxi_service_disabled: "Service taxi désactivé.",
  no_active_vehicle: "Aucun véhicule actif.",
  vehicle_documents_invalid: "Documents véhicule invalides ou expirés.",
  category_not_eligible: "Catégorie véhicule incompatible avec la course.",
  electric_required: "Course réservée pour véhicule électrique/hybride.",
  ride_not_paid: "Course non payée.",
  already_assigned: "Course déjà assignée.",
  ride_not_available: "Course non disponible.",
  validation_failed: "Acceptation refusée.",
};

export function isElectricSearchActive(params: {
  preferElectricOrHybrid: boolean;
  electricSearchExpired: boolean;
  electricSearchUntil: string | null;
  now?: Date;
}): boolean {
  if (!params.preferElectricOrHybrid || params.electricSearchExpired) return false;
  if (!params.electricSearchUntil) return true;
  const until = new Date(params.electricSearchUntil).getTime();
  return until > (params.now ?? new Date()).getTime();
}

export function resolveElectricSearchSeconds(
  rules: Array<{ country_code?: string | null; city?: string | null; electric_search_seconds?: number | null }>,
  countryCode: string | null,
  city: string | null,
): number {
  const country = String(countryCode ?? "").trim().toLowerCase();
  const cityNorm = String(city ?? "").trim().toLowerCase();

  const cityRule = rules.find(
    (r) =>
      String(r.country_code ?? "").trim().toLowerCase() === country &&
      String(r.city ?? "").trim().toLowerCase() === cityNorm,
  );
  if (cityRule?.electric_search_seconds != null) return cityRule.electric_search_seconds;

  const countryRule = rules.find(
    (r) =>
      String(r.country_code ?? "").trim().toLowerCase() === country &&
      !String(r.city ?? "").trim(),
  );
  if (countryRule?.electric_search_seconds != null) return countryRule.electric_search_seconds;

  const globalRule = rules.find((r) => !r.country_code && !r.city);
  return globalRule?.electric_search_seconds ?? 30;
}
