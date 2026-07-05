import {
  type DriverVehicleInput,
  type TaxiCategory,
  type VehicleCategoryEligibilityResult,
  type VehicleCategoryRule,
  type VehicleEligibilityStatus,
  TAXI_CATEGORIES,
} from "@/lib/driverServicePreferencesTypes";

export function normalizeTaxiCategory(input: string | null | undefined): TaxiCategory {
  const value = String(input ?? "standard").trim().toLowerCase();
  if (value === "premium" || value === "comfort") return "comfort";
  if (value === "xl") return "xl";
  if (value === "wheelchair" || value === "wheelchair_accessible") {
    return "wheelchair_accessible";
  }
  return "standard";
}

export function resolveVehicleCategoryRule(
  rules: VehicleCategoryRule[],
  input: { countryCode?: string | null; city?: string | null; category: TaxiCategory },
): VehicleCategoryRule | null {
  const country = String(input.countryCode ?? "").trim().toUpperCase();
  const city = String(input.city ?? "").trim().toLowerCase();
  const categoryRules = rules.filter((rule) => rule.category === input.category);
  if (categoryRules.length === 0) return null;

  const cityCountry = categoryRules.find(
    (rule) =>
      (rule as VehicleCategoryRule & { country_code?: string | null; city?: string | null })
        .country_code === country &&
      (rule as VehicleCategoryRule & { city?: string | null }).city?.toLowerCase() === city,
  );
  if (cityCountry) return cityCountry;

  const countryOnly = categoryRules.find(
    (rule) =>
      (rule as VehicleCategoryRule & { country_code?: string | null }).country_code === country &&
      !(rule as VehicleCategoryRule & { city?: string | null }).city,
  );
  if (countryOnly) return countryOnly;

  return categoryRules.find(
    (rule) =>
      !(rule as VehicleCategoryRule & { country_code?: string | null }).country_code &&
      !(rule as VehicleCategoryRule & { city?: string | null }).city,
  ) ?? null;
}

export function computeVehicleAge(
  vehicleYear: number | null | undefined,
  currentYear = new Date().getFullYear(),
): number | null {
  if (vehicleYear == null || !Number.isFinite(vehicleYear)) return null;
  return Math.max(0, currentYear - vehicleYear);
}

export function isDocumentApproved(status: string | null | undefined): boolean {
  return String(status ?? "").trim().toLowerCase() === "approved";
}

export function computeVehicleCategoryEligibility(input: {
  vehicle: DriverVehicleInput;
  driverRating: number | null;
  rule: VehicleCategoryRule;
  currentYear?: number;
  adminApproved?: boolean;
  adminSuspended?: boolean;
}): VehicleCategoryEligibilityResult {
  const {
    vehicle,
    driverRating,
    rule,
    currentYear = new Date().getFullYear(),
    adminApproved = false,
    adminSuspended = false,
  } = input;

  if (adminSuspended) {
    return {
      category: rule.category,
      status: "suspended",
      reason_code: "admin_suspended",
      reason_message: "Category suspended by admin",
    };
  }

  if (!vehicle.vehicle_active) {
    return fail(rule.category, "not_eligible", "vehicle_inactive", "Vehicle is not active");
  }

  const age = computeVehicleAge(vehicle.vehicle_year, currentYear);
  if (age == null) {
    return fail(rule.category, "not_eligible", "missing_vehicle_year", "Vehicle year is required");
  }

  if (age > rule.max_vehicle_age_years) {
    return fail(
      rule.category,
      "expired_age",
      "vehicle_too_old",
      `Vehicle exceeds ${rule.max_vehicle_age_years} year limit`,
    );
  }

  if ((vehicle.seats_count ?? 0) < rule.min_passenger_seats) {
    return fail(
      rule.category,
      "insufficient_seats",
      "insufficient_seats",
      `Minimum ${rule.min_passenger_seats} passenger seats required`,
    );
  }

  if (rule.requires_air_conditioning && !vehicle.has_air_conditioning) {
    return fail(
      rule.category,
      "not_eligible",
      "air_conditioning_required",
      "Air conditioning required for this category",
    );
  }

  if (rule.requires_wheelchair_equipment && !vehicle.wheelchair_accessible) {
    return fail(
      rule.category,
      "wheelchair_not_verified",
      "wheelchair_equipment_missing",
      "Wheelchair accessible equipment required",
    );
  }

  if (rule.requires_wheelchair_admin_verified && !vehicle.wheelchair_equipment_verified) {
    return fail(
      rule.category,
      "wheelchair_not_verified",
      "wheelchair_not_verified",
      "Wheelchair equipment must be verified by admin",
    );
  }

  if (
    rule.min_driver_rating != null &&
    (driverRating ?? 0) < rule.min_driver_rating
  ) {
    return fail(
      rule.category,
      "not_eligible",
      "driver_rating_too_low",
      `Minimum driver rating ${rule.min_driver_rating} required`,
    );
  }

  const vehicleType = String(vehicle.vehicle_type ?? "").trim().toLowerCase();
  if (
    rule.allowed_vehicle_types?.length &&
    !rule.allowed_vehicle_types.map((v) => v.toLowerCase()).includes(vehicleType)
  ) {
    return fail(
      rule.category,
      "not_eligible",
      "vehicle_type_not_allowed",
      "Vehicle type not allowed for this category",
    );
  }

  const docsOk =
    (!rule.requires_inspection_approved || isDocumentApproved(vehicle.inspection_status)) &&
    (!rule.requires_insurance_approved || isDocumentApproved(vehicle.insurance_status)) &&
    (!rule.requires_registration_approved || isDocumentApproved(vehicle.registration_status));

  if (!docsOk) {
    return fail(
      rule.category,
      "missing_documents",
      "missing_documents",
      "Required vehicle documents not approved",
    );
  }

  if (rule.requires_admin_approval && !adminApproved) {
    return fail(
      rule.category,
      "pending_review",
      "pending_admin_review",
      "Awaiting admin approval for this category",
    );
  }

  return {
    category: rule.category,
    status: "eligible",
    reason_code: null,
    reason_message: null,
  };
}

function fail(
  category: TaxiCategory,
  status: VehicleEligibilityStatus,
  reason_code: string,
  reason_message: string,
): VehicleCategoryEligibilityResult {
  return { category, status, reason_code, reason_message };
}

export function computeAllVehicleCategoryEligibility(input: {
  vehicle: DriverVehicleInput;
  driverRating: number | null;
  rules: VehicleCategoryRule[];
  currentYear?: number;
  adminApprovedCategories?: Partial<Record<TaxiCategory, boolean>>;
  adminSuspendedCategories?: Partial<Record<TaxiCategory, boolean>>;
}): VehicleCategoryEligibilityResult[] {
  const ruleByCategory = new Map(input.rules.map((rule) => [rule.category, rule]));

  return TAXI_CATEGORIES.map((category) => {
    const rule = ruleByCategory.get(category);
    if (!rule) {
      return fail(category, "not_eligible", "no_rule", "No category rule configured");
    }

    return computeVehicleCategoryEligibility({
      vehicle: input.vehicle,
      driverRating: input.driverRating,
      rule,
      currentYear: input.currentYear,
      adminApproved: input.adminApprovedCategories?.[category] === true,
      adminSuspended: input.adminSuspendedCategories?.[category] === true,
    });
  });
}

export function driverAcceptsService(
  preferences: {
    food_delivery_enabled?: boolean | null;
    package_delivery_enabled?: boolean | null;
    taxi_rides_enabled?: boolean | null;
  },
  service: "food" | "package" | "taxi",
): boolean {
  if (service === "food") return preferences.food_delivery_enabled === true;
  if (service === "package") return preferences.package_delivery_enabled === true;
  return preferences.taxi_rides_enabled === true;
}

export function hasAnyServiceEnabled(preferences: {
  food_delivery_enabled?: boolean | null;
  package_delivery_enabled?: boolean | null;
  taxi_rides_enabled?: boolean | null;
}): boolean {
  return (
    preferences.food_delivery_enabled === true ||
    preferences.package_delivery_enabled === true ||
    preferences.taxi_rides_enabled === true
  );
}

export const DEFAULT_VEHICLE_CATEGORY_RULES: VehicleCategoryRule[] = [
  {
    category: "standard",
    max_vehicle_age_years: 10,
    min_passenger_seats: 4,
    requires_air_conditioning: false,
    requires_wheelchair_equipment: false,
    requires_wheelchair_admin_verified: false,
    min_driver_rating: null,
    allowed_vehicle_types: null,
    requires_inspection_approved: true,
    requires_insurance_approved: true,
    requires_registration_approved: true,
    requires_admin_approval: false,
  },
  {
    category: "comfort",
    max_vehicle_age_years: 5,
    min_passenger_seats: 4,
    requires_air_conditioning: true,
    requires_wheelchair_equipment: false,
    requires_wheelchair_admin_verified: false,
    min_driver_rating: 4.5,
    allowed_vehicle_types: null,
    requires_inspection_approved: true,
    requires_insurance_approved: true,
    requires_registration_approved: true,
    requires_admin_approval: true,
  },
  {
    category: "xl",
    max_vehicle_age_years: 10,
    min_passenger_seats: 6,
    requires_air_conditioning: false,
    requires_wheelchair_equipment: false,
    requires_wheelchair_admin_verified: false,
    min_driver_rating: null,
    allowed_vehicle_types: ["suv", "van", "minivan"],
    requires_inspection_approved: true,
    requires_insurance_approved: true,
    requires_registration_approved: true,
    requires_admin_approval: true,
  },
  {
    category: "wheelchair_accessible",
    max_vehicle_age_years: 10,
    min_passenger_seats: 4,
    requires_air_conditioning: false,
    requires_wheelchair_equipment: true,
    requires_wheelchair_admin_verified: true,
    min_driver_rating: null,
    allowed_vehicle_types: null,
    requires_inspection_approved: true,
    requires_insurance_approved: true,
    requires_registration_approved: true,
    requires_admin_approval: true,
  },
];
