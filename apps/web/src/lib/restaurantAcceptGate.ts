import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isRestaurantWithinOpeningHours,
  type OpeningHoursMap,
} from "@/lib/restaurantOpeningHours";

export type RestaurantAcceptGateResult =
  | { ok: true; profile: RestaurantAcceptProfile }
  | { ok: false; error: string; message: string; httpStatus: number };

export type RestaurantAcceptProfile = {
  user_id: string;
  restaurant_name: string | null;
  status: string | null;
  is_accepting_orders: boolean | null;
  is_busy?: boolean | null;
  opening_hours?: OpeningHoursMap | null;
};

export async function assertRestaurantCanAcceptOrders(
  supabaseAdmin: SupabaseClient,
  restaurantUserId: string,
  now = new Date(),
): Promise<RestaurantAcceptGateResult> {
  const { data, error } = await supabaseAdmin
    .from("restaurant_profiles")
    .select(
      "user_id, restaurant_name, status, is_accepting_orders, is_busy, opening_hours",
    )
    .eq("user_id", restaurantUserId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      error: "restaurant_lookup_failed",
      message: "Impossible de vérifier le restaurant pour le moment.",
      httpStatus: 500,
    };
  }

  if (!data) {
    return {
      ok: false,
      error: "restaurant_not_found",
      message: "Restaurant introuvable.",
      httpStatus: 404,
    };
  }

  const profile = data as RestaurantAcceptProfile;
  const status = String(profile.status ?? "").toLowerCase();

  if (status !== "approved") {
    return {
      ok: false,
      error: "restaurant_not_approved",
      message: "Ce restaurant n'accepte pas encore de commandes.",
      httpStatus: 403,
    };
  }

  if (profile.is_accepting_orders !== true) {
    return {
      ok: false,
      error: "restaurant_not_accepting_orders",
      message: "Ce restaurant est actuellement fermé.",
      httpStatus: 403,
    };
  }

  if (profile.is_busy === true) {
    return {
      ok: false,
      error: "restaurant_busy",
      message: "Ce restaurant est temporairement occupé et n'accepte pas de nouvelles commandes.",
      httpStatus: 403,
    };
  }

  if (!isRestaurantWithinOpeningHours(profile.opening_hours ?? null, now)) {
    return {
      ok: false,
      error: "restaurant_outside_hours",
      message: "Ce restaurant est en dehors de ses horaires d'ouverture.",
      httpStatus: 403,
    };
  }

  return { ok: true, profile };
}
