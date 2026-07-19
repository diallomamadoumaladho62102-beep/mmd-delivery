import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fire-and-forget loyalty accrual helpers.
 *
 * These are invoked from order/ride completion paths AFTER the primary business
 * operation has already succeeded. They must NEVER throw or block the caller:
 * loyalty is a secondary concern and a failure here must not fail a delivery,
 * a ride, or a payment. All exactly-once / eligibility / anti-fraud logic lives
 * in the SECURITY DEFINER RPCs; here we only dispatch and swallow errors.
 */

type AccrualVertical = "food_order" | "taxi_ride" | "marketplace_order" | "delivery_request";

const RPC_BY_VERTICAL: Record<AccrualVertical, string> = {
  food_order: "mmd_accrue_food_order",
  taxi_ride: "mmd_accrue_taxi_ride",
  marketplace_order: "mmd_accrue_marketplace_order",
  delivery_request: "mmd_accrue_delivery_request",
};

const PARAM_BY_VERTICAL: Record<AccrualVertical, string> = {
  food_order: "p_order_id",
  taxi_ride: "p_ride_id",
  marketplace_order: "p_seller_order_id",
  delivery_request: "p_request_id",
};

async function accrue(
  supabaseAdmin: SupabaseClient,
  vertical: AccrualVertical,
  entityId: string
): Promise<void> {
  const id = String(entityId ?? "").trim();
  if (!id) return;

  try {
    const { error } = await supabaseAdmin.rpc(RPC_BY_VERTICAL[vertical], {
      [PARAM_BY_VERTICAL[vertical]]: id,
    });
    if (error) {
      console.error("[loyalty] accrual rpc error", {
        vertical,
        entity_id: id,
        message: error.message,
      });
    }
  } catch (e) {
    console.error("[loyalty] accrual threw (ignored)", {
      vertical,
      entity_id: id,
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

export function awardFoodOrderLoyalty(
  supabaseAdmin: SupabaseClient,
  orderId: string
): Promise<void> {
  return accrue(supabaseAdmin, "food_order", orderId);
}

export function awardTaxiRideLoyalty(
  supabaseAdmin: SupabaseClient,
  rideId: string
): Promise<void> {
  return accrue(supabaseAdmin, "taxi_ride", rideId);
}

export function awardMarketplaceOrderLoyalty(
  supabaseAdmin: SupabaseClient,
  sellerOrderId: string
): Promise<void> {
  return accrue(supabaseAdmin, "marketplace_order", sellerOrderId);
}

export function awardDeliveryRequestLoyalty(
  supabaseAdmin: SupabaseClient,
  requestId: string
): Promise<void> {
  return accrue(supabaseAdmin, "delivery_request", requestId);
}
