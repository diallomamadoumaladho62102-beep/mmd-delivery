/**
 * Signup routing rules that must stay independent of the signed-in screen.
 * Seller is a client overlay (public.sellers). It must not hide a driver,
 * restaurant, or staff profile.
 */

export function selectedSellerAppliesToProfile(
  dbRole: string | null | undefined,
): boolean {
  const role = String(dbRole ?? "").trim().toLowerCase();
  return role === "" || role === "client" || role === "customer" || role === "seller";
}

export function isApprovedDriverStatus(
  status: string | null | undefined,
): boolean {
  return String(status ?? "").trim().toLowerCase() === "approved";
}

/** Screens a driver may keep while approval is still required. */
const PENDING_DRIVER_ROUTES = new Set([
  "DriverOnboarding",
  "DriverVehicles",
  "DriverVehicle",
  "DriverProfile",
  "DriverWallet",
  "DriverServices",
  "DriverIdentityVerification",
  "RoleSelect",
  "DriverAuth",
]);

export function pendingDriverMayStayOn(route: string | null | undefined): boolean {
  return PENDING_DRIVER_ROUTES.has(String(route ?? ""));
}

/**
 * Fields saved on the Auth user at signup, including when email confirmation
 * delays the session. Restored into driver_profiles on the first login.
 *
 * Non-bike modes must include brand/model/plate/license so the insert satisfies
 * `driver_profiles_vehicle_fields_check`. Bike may leave vehicle columns null.
 */
export function buildDriverProfileFromSignupMetadata(
  userId: string,
  meta: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  const role = String(meta?.role ?? "").trim().toLowerCase();
  if (role !== "driver") return null;

  const fullName = String(meta?.full_name ?? "").trim();
  const phone = String(meta?.phone ?? "").trim();
  if (!fullName || !phone) return null;

  const requestedMode = String(meta?.transport_mode ?? "bike").trim().toLowerCase();
  const transportMode =
    requestedMode === "car" || requestedMode === "moto" || requestedMode === "bike"
      ? requestedMode
      : "bike";
  const isBike = transportMode === "bike";
  const licenseNumber = String(meta?.license_number ?? "").trim() || null;
  const vehicleBrand = String(meta?.vehicle_brand ?? "").trim() || null;
  const vehicleModel = String(meta?.vehicle_model ?? "").trim() || null;
  const plateNumber = String(meta?.plate_number ?? "").trim().toUpperCase() || null;
  const vehicleColor = String(meta?.vehicle_color ?? "").trim() || null;
  const yearRaw = String(meta?.vehicle_year ?? "").trim();
  const vehicleYear = yearRaw && Number.isFinite(Number(yearRaw)) ? Number(yearRaw) : null;

  // Prefer bike when car/moto metadata is incomplete — avoids CHECK failure on restore.
  const safeMode =
    isBike || (vehicleBrand && vehicleModel && plateNumber && licenseNumber)
      ? transportMode
      : "bike";

  return {
    id: userId,
    user_id: userId,
    full_name: fullName,
    phone,
    emergency_phone: String(meta?.emergency_phone ?? "").trim() || null,
    address: String(meta?.address ?? "").trim() || null,
    city: String(meta?.city ?? "").trim() || null,
    state: String(meta?.state ?? "").trim().toUpperCase() || null,
    zip_code: String(meta?.zip_code ?? "").trim() || null,
    date_of_birth: String(meta?.date_of_birth ?? "").trim() || null,
    transport_mode: safeMode,
    status: "pending",
    is_online: false,
    vehicle_type: safeMode,
    license_number: safeMode === "bike" ? null : licenseNumber,
    vehicle_brand: safeMode === "bike" ? null : vehicleBrand,
    vehicle_model: safeMode === "bike" ? null : vehicleModel,
    vehicle_year: safeMode === "bike" ? null : vehicleYear,
    vehicle_color: safeMode === "bike" ? null : vehicleColor,
    plate_number: safeMode === "bike" ? null : plateNumber,
  };
}
