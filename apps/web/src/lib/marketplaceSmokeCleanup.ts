import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const SMOKE_SELLER_ADDRESS = "Smoke test seller address";
const SMOKE_DROPOFF_ADDRESS = "Smoke dropoff, Conakry, GN";

export type MarketplaceSmokeCreated = {
  userId?: string | null;
  sellerId?: string | null;
  productId?: string | null;
  productCreated?: boolean;
  orderIds?: string[];
  jobId?: string | null;
  sellerPayoutId?: string | null;
  driverPayoutId?: string | null;
  locationId?: string | null;
};

/** Reuse or create only the smoke seller owned by the E2E user. Never picks another seller. */
export async function ensureSmokeSeller(
  admin: SupabaseClient,
  userId: string,
): Promise<{ id: string }> {
  const { data: existing, error: existingError } = await admin
    .from("sellers")
    .select("id")
    .eq("user_id", userId)
    .eq("country_code", "GN")
    .eq("address", SMOKE_SELLER_ADDRESS)
    .maybeSingle();
  if (existingError) {
    throw new Error(`smoke seller lookup failed: ${existingError.message}`);
  }
  if (existing?.id) return { id: existing.id };

  const { data, error } = await admin
    .from("sellers")
    .insert({
      user_id: userId,
      business_name: `Smoke Seller ${randomUUID().slice(0, 8)}`,
      country_code: "GN",
      city: "Conakry",
      address: SMOKE_SELLER_ADDRESS,
      phone: "+224600000000",
      status: "approved",
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !data?.id) {
    throw new Error(`smoke seller insert failed: ${error?.message ?? "missing id"}`);
  }
  return { id: data.id };
}

/**
 * Delete only the rows this smoke run recorded.
 * The seller row is removed only when it is the smoke fixture and has no orders left.
 */
export async function cleanupMarketplaceSmoke(
  admin: SupabaseClient,
  created: MarketplaceSmokeCreated,
): Promise<void> {
  if (created.driverPayoutId) {
    await admin.from("marketplace_driver_payouts").delete().eq("id", created.driverPayoutId);
  }
  if (created.sellerPayoutId) {
    await admin.from("marketplace_seller_payouts").delete().eq("id", created.sellerPayoutId);
  }
  if (created.jobId) {
    await admin.from("marketplace_delivery_jobs").delete().eq("id", created.jobId);
  }
  for (const orderId of created.orderIds ?? []) {
    await admin.from("seller_orders").delete().eq("id", orderId);
  }
  if (created.locationId && created.userId) {
    await admin
      .from("location_points")
      .delete()
      .eq("id", created.locationId)
      .eq("owner_user_id", created.userId)
      .eq("formatted_address", SMOKE_DROPOFF_ADDRESS);
  }
  if (created.productCreated && created.productId && created.sellerId) {
    await admin
      .from("seller_products")
      .delete()
      .eq("id", created.productId)
      .eq("seller_id", created.sellerId);
  }
  if (!created.sellerId || !created.userId) return;
  const { count } = await admin
    .from("seller_orders")
    .select("id", { count: "exact", head: true })
    .eq("seller_id", created.sellerId);
  if ((count ?? 0) > 0) return;
  await admin
    .from("sellers")
    .delete()
    .eq("id", created.sellerId)
    .eq("user_id", created.userId)
    .eq("country_code", "GN")
    .eq("address", SMOKE_SELLER_ADDRESS);
}
