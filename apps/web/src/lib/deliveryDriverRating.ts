import type { SupabaseClient } from "@supabase/supabase-js";

export type DeliveryDriverRatingInput = {
  supabaseAdmin: SupabaseClient;
  orderId: string;
  driverId: string;
  raterUserId: string;
  rating: number;
  comment: string | null;
  sourceType?: "food_order" | "delivery_request";
  sourceId?: string | null;
};

/**
 * Persist Client→Driver stars into driver_ratings (feeds driver_rating_summary).
 * Keeps order_ratings separate for restaurant/order experience.
 */
export async function upsertDeliveryDriverRating(
  input: DeliveryDriverRatingInput
): Promise<{ ok: true; created: boolean } | { ok: false; error: string }> {
  const rating = Math.round(Number(input.rating));
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    return { ok: false, error: "rating_must_be_1_to_5" };
  }
  const comment =
    input.comment == null
      ? null
      : String(input.comment).trim().slice(0, 800) || null;
  const nowIso = new Date().toISOString();
  const sourceType = input.sourceType ?? "food_order";
  const sourceId = String(input.sourceId ?? input.orderId).trim();

  const { data: existing } = await input.supabaseAdmin
    .from("driver_ratings")
    .select("id")
    .eq("order_id", input.orderId)
    .eq("rater_user_id", input.raterUserId)
    .maybeSingle();

  if (existing?.id) {
    return { ok: true, created: false };
  }

  const { error } = await input.supabaseAdmin.from("driver_ratings").insert({
    order_id: input.orderId,
    ratee_driver_id: input.driverId,
    rater_user_id: input.raterUserId,
    rater_id: input.raterUserId,
    rating,
    comment,
    source_type: sourceType,
    source_id: sourceId,
    taxi_ride_id: null,
    created_at: nowIso,
  });

  if (error) {
    if (String(error.code ?? "") === "23505") {
      return { ok: true, created: false };
    }
    return { ok: false, error: error.message };
  }

  try {
    await input.supabaseAdmin.rpc("refresh_driver_rating", {
      p_driver_id: input.driverId,
    });
  } catch {
    /* summary VIEW still works without profile mirror */
  }

  return { ok: true, created: true };
}
