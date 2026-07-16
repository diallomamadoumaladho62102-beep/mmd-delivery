import type { SupabaseClient } from "@supabase/supabase-js";

export type DriverOnlineGateResult =
  | { ok: true; is_online?: boolean }
  | { ok: false; error: string; message: string };

const ONLINE_MESSAGES: Record<string, string> = {
  not_authenticated: "Vous devez être connecté.",
  driver_profile_not_found: "Profil chauffeur introuvable.",
  driver_not_approved: "Votre compte chauffeur doit être approuvé avant de passer en ligne.",
  driver_suspended: "Votre compte chauffeur est suspendu.",
  driver_disabled: "Votre compte chauffeur est désactivé.",
  no_service_enabled: "Activez au moins un service (Food, Colis ou Taxi) avant de passer en ligne.",
  no_active_vehicle: "Sélectionnez un véhicule actif et approuvé avant de passer en ligne.",
  vehicle_not_eligible: "Votre véhicule actif n'est pas éligible. Attendez la validation admin ou choisissez un autre véhicule.",
  vehicle_pending_review: "Votre véhicule est en attente de validation. Vous pourrez passer en ligne après approbation.",
  vehicle_rejected: "Votre véhicule a été refusé. Corrigez les informations ou ajoutez un nouveau véhicule.",
};

function messageFor(code: string, fallback?: string) {
  return ONLINE_MESSAGES[code] ?? fallback ?? "Impossible de changer le statut pour le moment.";
}

export async function assertDriverCanGoOnline(
  supabaseAdmin: SupabaseClient,
  userId: string,
): Promise<DriverOnlineGateResult> {
  if (!userId) {
    return { ok: false, error: "not_authenticated", message: messageFor("not_authenticated") };
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from("driver_profiles")
    .select("status, transport_mode, active_vehicle_id, is_online")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError) {
    return {
      ok: false,
      error: "driver_profile_load_failed",
      message: "Impossible de vérifier votre profil chauffeur pour le moment.",
    };
  }

  if (!profile) {
    return {
      ok: false,
      error: "driver_profile_not_found",
      message: messageFor("driver_profile_not_found"),
    };
  }

  const status = String(profile.status ?? "").toLowerCase();
  if (status === "suspended") {
    return { ok: false, error: "driver_suspended", message: messageFor("driver_suspended") };
  }
  if (status === "disabled") {
    return { ok: false, error: "driver_disabled", message: messageFor("driver_disabled") };
  }
  if (status !== "approved") {
    return { ok: false, error: "driver_not_approved", message: messageFor("driver_not_approved") };
  }

  const { data: prefs } = await supabaseAdmin
    .from("driver_service_preferences")
    .select("food_delivery_enabled, package_delivery_enabled, taxi_rides_enabled")
    .eq("driver_user_id", userId)
    .maybeSingle();

  const hasService =
    Boolean(prefs?.food_delivery_enabled) ||
    Boolean(prefs?.package_delivery_enabled) ||
    Boolean(prefs?.taxi_rides_enabled);

  if (!hasService) {
    return { ok: false, error: "no_service_enabled", message: messageFor("no_service_enabled") };
  }

  const transportMode = String(profile.transport_mode ?? "").toLowerCase();
  const requiresVehicle =
    transportMode === "car" ||
    transportMode === "moto" ||
    Boolean(prefs?.taxi_rides_enabled);

  if (!requiresVehicle) {
    return { ok: true };
  }

  const activeVehicleId = profile.active_vehicle_id
    ? String(profile.active_vehicle_id)
    : "";

  if (!activeVehicleId) {
    return { ok: false, error: "no_active_vehicle", message: messageFor("no_active_vehicle") };
  }

  const { data: vehicle, error: vehicleError } = await supabaseAdmin
    .from("driver_vehicles")
    .select(
      "id, vehicle_status, vehicle_active, admin_review_status, deleted_at",
    )
    .eq("id", activeVehicleId)
    .eq("driver_user_id", userId)
    .maybeSingle();

  if (vehicleError || !vehicle || vehicle.deleted_at) {
    return { ok: false, error: "no_active_vehicle", message: messageFor("no_active_vehicle") };
  }

  const review = String(vehicle.admin_review_status ?? "").toLowerCase();
  const vehicleStatus = String(vehicle.vehicle_status ?? "").toLowerCase();

  if (review === "pending_review" || vehicleStatus === "pending_review") {
    return {
      ok: false,
      error: "vehicle_pending_review",
      message: messageFor("vehicle_pending_review"),
    };
  }

  if (review === "rejected" || vehicleStatus === "rejected") {
    return { ok: false, error: "vehicle_rejected", message: messageFor("vehicle_rejected") };
  }

  if (
    vehicle.vehicle_active !== true ||
    vehicleStatus !== "active" ||
    review !== "approved"
  ) {
    return {
      ok: false,
      error: "vehicle_not_eligible",
      message: messageFor("vehicle_not_eligible"),
    };
  }

  return { ok: true };
}

export async function setDriverOnlineStatusAdmin(
  supabaseAdmin: SupabaseClient,
  userId: string,
  nextOnline: boolean,
): Promise<DriverOnlineGateResult> {
  if (!userId) {
    return { ok: false, error: "not_authenticated", message: messageFor("not_authenticated") };
  }

  if (nextOnline) {
    const gate = await assertDriverCanGoOnline(supabaseAdmin, userId);
    if (!gate.ok) return gate;
  }

  const { data, error } = await supabaseAdmin
    .from("driver_profiles")
    .update({
      is_online: nextOnline,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .select("is_online")
    .maybeSingle();

  if (error || !data || Boolean(data.is_online) !== nextOnline) {
    return {
      ok: false,
      error: "online_status_update_failed",
      message: nextOnline
        ? "Impossible de confirmer le passage en ligne pour le moment."
        : "Impossible de confirmer le passage hors ligne pour le moment.",
    };
  }

  return { ok: true, is_online: Boolean(data.is_online) };
}

/** Fields that require a fresh admin review when changed by the driver. */
export const MATERIAL_VEHICLE_FIELDS = [
  "vehicle_make",
  "vehicle_model",
  "vehicle_year",
  "vehicle_color",
  "license_plate",
  "seats_count",
  "vehicle_type",
  "has_air_conditioning",
  "wheelchair_accessible",
] as const;

export function didMaterialVehicleFieldsChange(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): boolean {
  for (const key of MATERIAL_VEHICLE_FIELDS) {
    if (!(key in patch)) continue;
    const prev = before[key];
    const next = patch[key];
    if (String(prev ?? "") !== String(next ?? "")) return true;
  }
  return false;
}
