import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Supersede pending driver offers when an order/DR reaches a terminal status.
 * Taxi cancel already expires taxi_offers; food/DR must do the same or stale
 * pending offers keep cancelled jobs visible in the Driver app.
 */
export async function expirePendingDriverOrderOffers(
  supabase: SupabaseClient,
  orderId: string
): Promise<void> {
  const id = String(orderId ?? "").trim();
  if (!id) return;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("driver_order_offers")
    .update({ status: "expired", updated_at: now })
    .eq("order_id", id)
    .eq("status", "pending");
  if (error) {
    console.warn("[expirePendingDriverOrderOffers]", id, error.message);
  }
}

export async function expirePendingDeliveryRequestOffers(
  supabase: SupabaseClient,
  deliveryRequestId: string
): Promise<void> {
  const id = String(deliveryRequestId ?? "").trim();
  if (!id) return;
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("delivery_request_driver_offers")
    .update({ status: "expired", updated_at: now })
    .eq("delivery_request_id", id)
    .eq("status", "pending");
  if (error) {
    console.warn("[expirePendingDeliveryRequestOffers]", id, error.message);
  }
}
