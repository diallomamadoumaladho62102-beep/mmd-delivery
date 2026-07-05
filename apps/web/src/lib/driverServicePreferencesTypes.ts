export type DriverServiceKey = "food" | "package" | "taxi";

export type DriverServicePreferences = {
  driver_user_id: string;
  food_delivery_enabled: boolean;
  package_delivery_enabled: boolean;
  taxi_rides_enabled: boolean;
  updated_at?: string | null;
};

export const DEFAULT_DRIVER_SERVICE_PREFERENCES: Omit<
  DriverServicePreferences,
  "driver_user_id"
> = {
  food_delivery_enabled: false,
  package_delivery_enabled: false,
  taxi_rides_enabled: false,
};

export type TaxiCategory =
  | "standard"
  | "comfort"
  | "xl"
  | "wheelchair_accessible";

export type VehicleEligibilityStatus =
  | "eligible"
  | "not_eligible"
  | "pending_review"
  | "suspended"
  | "expired_age"
  | "missing_documents"
  | "insufficient_seats"
  | "wheelchair_not_verified";

export type VehicleCategoryRule = {
  category: TaxiCategory;
  max_vehicle_age_years: number;
  min_passenger_seats: number;
  requires_air_conditioning: boolean;
  requires_wheelchair_equipment: boolean;
  requires_wheelchair_admin_verified: boolean;
  min_driver_rating: number | null;
  allowed_vehicle_types: string[] | null;
  requires_inspection_approved: boolean;
  requires_insurance_approved: boolean;
  requires_registration_approved: boolean;
  requires_admin_approval: boolean;
};

export type DriverVehicleInput = {
  vehicle_year: number | null;
  seats_count: number;
  vehicle_type: string | null;
  has_air_conditioning: boolean;
  wheelchair_accessible: boolean;
  wheelchair_equipment_verified: boolean;
  inspection_status: string;
  insurance_status: string;
  registration_status: string;
  vehicle_active: boolean;
};

export type VehicleCategoryEligibilityResult = {
  category: TaxiCategory;
  status: VehicleEligibilityStatus;
  reason_code: string | null;
  reason_message: string | null;
};

export const TAXI_CATEGORIES: TaxiCategory[] = [
  "standard",
  "comfort",
  "xl",
  "wheelchair_accessible",
];

export const TAXI_CATEGORY_LABELS: Record<TaxiCategory, string> = {
  standard: "Standard",
  comfort: "Comfort",
  xl: "XL",
  wheelchair_accessible: "Wheelchair Accessible",
};
