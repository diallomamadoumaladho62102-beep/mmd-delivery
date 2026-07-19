import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fire-and-forget restaurant loyalty hooks (Phase 2).
 *
 * Invoked AFTER a food order is finalized (delivered + paid). Like the
 * client/driver accrual helpers, these must NEVER throw or block the caller: a
 * loyalty failure must not affect an order, a payment, a delivery, or a
 * restaurant payout. All eligibility / exactly-once / anti-fraud logic lives in
 * the SECURITY DEFINER RPCs; here we only dispatch and swallow errors.
 */
export async function awardRestaurantOrderPerformance(
  supabaseAdmin: SupabaseClient,
  orderId: string
): Promise<void> {
  const id = String(orderId ?? "").trim();
  if (!id) return;

  try {
    const { error } = await supabaseAdmin.rpc("mmd_restaurant_on_order_completed", {
      p_order_id: id,
    });
    if (error) {
      console.error("[restaurant-loyalty] on_order_completed rpc error", {
        order_id: id,
        message: error.message,
      });
    }
  } catch (e) {
    console.error("[restaurant-loyalty] hook threw (ignored)", {
      order_id: id,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
