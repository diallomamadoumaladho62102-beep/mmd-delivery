import type { SupabaseClient } from "@supabase/supabase-js";
import { isRestaurantOrderEligible } from "./accountStatus";

export type RestaurantOrderAccessResult =
  | { ok: true; status: string }
  | { ok: false; error: string; httpStatus: number };

export async function assertRestaurantOrderEligible(
  supabaseAdmin: SupabaseClient,
  userId: string
): Promise<RestaurantOrderAccessResult> {
  const { data, error } = await supabaseAdmin
    .from("restaurant_profiles")
    .select("status")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message, httpStatus: 500 };
  }

  if (!data) {
    return {
      ok: false,
      error: "Restaurant profile not found",
      httpStatus: 403,
    };
  }

  const status = String(data.status ?? "").trim().toLowerCase();

  if (!isRestaurantOrderEligible(status)) {
    if (status === "suspended") {
      return {
        ok: false,
        error: "Restaurant account is suspended",
        httpStatus: 403,
      };
    }

    if (status === "disabled") {
      return {
        ok: false,
        error: "Restaurant account is disabled",
        httpStatus: 403,
      };
    }

    return {
      ok: false,
      error: "Restaurant account is not approved",
      httpStatus: 403,
    };
  }

  return { ok: true, status };
}
