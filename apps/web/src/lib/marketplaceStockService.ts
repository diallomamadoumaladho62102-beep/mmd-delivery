import type { SupabaseClient } from "@supabase/supabase-js";

export async function decrementMarketplaceStockForPaidOrder(
  supabaseAdmin: SupabaseClient,
  sellerOrderId: string
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabaseAdmin.rpc("mmd_decrement_marketplace_stock", {
    p_seller_order_id: sellerOrderId,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true };
}
