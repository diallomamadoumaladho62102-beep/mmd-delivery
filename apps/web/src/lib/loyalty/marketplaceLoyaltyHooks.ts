import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fire-and-forget marketplace seller loyalty hook (Phase 3).
 *
 * Invoked AFTER a marketplace seller order is finalized (paid). Like the
 * client/driver/restaurant accrual helpers, this must NEVER throw or block the
 * caller: a loyalty failure must not affect an order, a payment, a delivery, or
 * a seller payout. All eligibility / exactly-once / anti-fraud logic lives in
 * the SECURITY DEFINER RPCs; here we only dispatch and swallow errors.
 */
export async function awardSellerOrderPerformance(
  supabaseAdmin: SupabaseClient,
  sellerOrderId: string
): Promise<void> {
  const id = String(sellerOrderId ?? "").trim();
  if (!id) return;

  try {
    const { error } = await supabaseAdmin.rpc("mmd_marketplace_on_order_completed", {
      p_seller_order_id: id,
    });
    if (error) {
      console.error("[marketplace-loyalty] on_order_completed rpc error", {
        seller_order_id: id,
        message: error.message,
      });
    }
  } catch (e) {
    console.error("[marketplace-loyalty] hook threw (ignored)", {
      seller_order_id: id,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}
