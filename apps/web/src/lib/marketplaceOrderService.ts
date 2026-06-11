import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeMarketplaceCheckoutShadow,
  type MarketplaceCheckoutShadow,
} from "@/lib/marketplaceCheckout";
import { persistMarketplaceDeliveryShadow } from "@/lib/marketplaceDeliveryShadow";

export type MarketplaceDraftItemInput = {
  product_id: string;
  quantity: number;
};

export type MarketplaceOrderItemRow = {
  id: string;
  order_id: string;
  product_id: string | null;
  title: string;
  price_cents: number;
  quantity: number;
  currency: string;
};

export type MarketplaceOrderRow = {
  id: string;
  seller_id: string;
  client_user_id: string | null;
  status: string;
  currency: string;
  subtotal_cents: number;
  delivery_fee_cents: number;
  service_fee_cents: number;
  total_cents: number;
  country_code: string | null;
  region_code: string | null;
  notes: string | null;
  checkout_shadow: MarketplaceCheckoutShadow | Record<string, unknown>;
  pickup_location_id?: string | null;
  dropoff_location_id?: string | null;
  seller_pickup_address?: string | null;
  delivery_status_shadow?: string | null;
  delivery_quote_shadow?: Record<string, unknown> | null;
  estimated_distance_miles?: number | null;
  estimated_minutes?: number | null;
  driver_earning_shadow_cents?: number | null;
  platform_margin_shadow_cents?: number | null;
  dispatch_shadow?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  items?: MarketplaceOrderItemRow[];
};

type ProductRow = {
  id: string;
  seller_id: string;
  title: string;
  price_cents: number;
  currency: string;
  active: boolean;
};

export async function loadApprovedSellerProducts(
  supabaseAdmin: SupabaseClient,
  sellerId?: string
) {
  if (sellerId) {
    const seller = await assertApprovedSeller(supabaseAdmin, sellerId);
    if (!seller) return [];
  }

  let query = supabaseAdmin
    .from("seller_products")
    .select(
      "id,seller_id,title,description,price_cents,currency,category,image_paths,active,created_at,updated_at"
    )
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(200);

  if (sellerId) query = query.eq("seller_id", sellerId);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  if (!sellerId && data?.length) {
    const sellerIds = [...new Set(data.map((row) => row.seller_id))];
    const { data: sellers, error: sellersError } = await supabaseAdmin
      .from("sellers")
      .select("id")
      .in("id", sellerIds)
      .eq("status", "approved");

    if (sellersError) throw new Error(sellersError.message);
    const approved = new Set((sellers ?? []).map((row) => row.id));
    return data.filter((row) => approved.has(row.seller_id));
  }

  return data ?? [];
}

async function assertApprovedSeller(
  supabaseAdmin: SupabaseClient,
  sellerId: string
) {
  const { data, error } = await supabaseAdmin
    .from("sellers")
    .select("id,business_name,country_code,city,status")
    .eq("id", sellerId)
    .eq("status", "approved")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

export async function loadApprovedSellers(supabaseAdmin: SupabaseClient) {
  const { data, error } = await supabaseAdmin
    .from("sellers")
    .select("id,business_name,country_code,city,address,region_code,status,created_at")
    .eq("status", "approved")
    .order("business_name", { ascending: true })
    .limit(200);

  if (error) throw new Error(error.message);
  return data ?? [];
}

const ORDER_SELECT =
  "id,seller_id,client_user_id,status,currency,subtotal_cents,delivery_fee_cents,service_fee_cents,total_cents,country_code,region_code,notes,checkout_shadow,pickup_location_id,dropoff_location_id,seller_pickup_address,delivery_status_shadow,delivery_quote_shadow,estimated_distance_miles,estimated_minutes,driver_earning_shadow_cents,platform_margin_shadow_cents,dispatch_shadow,created_at,updated_at";

export async function getClientDraftOrder(
  supabaseAdmin: SupabaseClient,
  params: {
    clientUserId: string;
    sellerId?: string;
    orderId?: string;
  }
): Promise<MarketplaceOrderRow | null> {
  if (params.orderId) {
    const res = await supabaseAdmin
      .from("seller_orders")
      .select(ORDER_SELECT)
      .eq("id", params.orderId)
      .eq("client_user_id", params.clientUserId)
      .in("status", ["draft", "pending_checkout"])
      .maybeSingle();

    if (res.error) throw new Error(res.error.message);
    if (!res.data) return null;
    return attachOrderItems(supabaseAdmin, res.data as MarketplaceOrderRow);
  }

  let draftQuery = supabaseAdmin
    .from("seller_orders")
    .select(ORDER_SELECT)
    .eq("client_user_id", params.clientUserId)
    .in("status", ["draft", "pending_checkout"]);

  if (params.sellerId) draftQuery = draftQuery.eq("seller_id", params.sellerId);

  const res = await draftQuery.order("updated_at", { ascending: false }).limit(1).maybeSingle();
  if (res.error) throw new Error(res.error.message);
  if (!res.data) return null;
  return attachOrderItems(supabaseAdmin, res.data as MarketplaceOrderRow);
}

async function attachOrderItems(
  supabaseAdmin: SupabaseClient,
  order: MarketplaceOrderRow
): Promise<MarketplaceOrderRow> {
  const { data, error } = await supabaseAdmin
    .from("seller_order_items")
    .select("id,order_id,product_id,title,price_cents,quantity,currency")
    .eq("order_id", order.id)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);
  return { ...order, items: (data as MarketplaceOrderItemRow[]) ?? [] };
}

async function assertClientOwnsLocationPoint(
  supabaseAdmin: SupabaseClient,
  locationId: string,
  clientUserId: string,
  label: string
): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("location_points")
    .select("id,owner_user_id")
    .eq("id", locationId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || String(data.owner_user_id) !== clientUserId) {
    throw new Error(`Invalid ${label}`);
  }

  return String(data.id);
}

export async function upsertMarketplaceDraftOrder(
  supabaseAdmin: SupabaseClient,
  params: {
    clientUserId: string;
    sellerId: string;
    countryCode?: string | null;
    orderId?: string;
    items: MarketplaceDraftItemInput[];
    notes?: string | null;
    pickupLocationId?: string | null;
    dropoffLocationId?: string | null;
  }
): Promise<MarketplaceOrderRow> {
  const productIds = params.items.map((item) => item.product_id);
  if (productIds.length === 0) {
    throw new Error("Cart is empty");
  }

  if (params.pickupLocationId) {
    await assertClientOwnsLocationPoint(
      supabaseAdmin,
      params.pickupLocationId,
      params.clientUserId,
      "pickup_location_id"
    );
  }

  if (params.dropoffLocationId) {
    await assertClientOwnsLocationPoint(
      supabaseAdmin,
      params.dropoffLocationId,
      params.clientUserId,
      "dropoff_location_id"
    );
  }

  const { data: products, error: productsError } = await supabaseAdmin
    .from("seller_products")
    .select("id,seller_id,title,price_cents,currency,active")
    .in("id", productIds)
    .eq("seller_id", params.sellerId)
    .eq("active", true);

  if (productsError) throw new Error(productsError.message);

  const productMap = new Map(
    ((products as ProductRow[]) ?? []).map((product) => [product.id, product])
  );

  const lineItems = params.items.map((item) => {
    const product = productMap.get(item.product_id);
    if (!product) throw new Error(`Invalid product: ${item.product_id}`);
    const quantity = Math.max(1, Math.round(item.quantity));
    return {
      product_id: product.id,
      title: product.title,
      price_cents: product.price_cents,
      quantity,
      currency: product.currency,
    };
  });

  const shadow = computeMarketplaceCheckoutShadow(
    lineItems.map((item) => ({
      price_cents: item.price_cents,
      quantity: item.quantity,
    }))
  );

  const currency = lineItems[0]?.currency ?? "USD";
  let orderId = params.orderId ?? null;

  if (orderId) {
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("seller_orders")
      .select("id,status,client_user_id,seller_id")
      .eq("id", orderId)
      .maybeSingle();

    if (existingError) throw new Error(existingError.message);
    if (
      !existing ||
      existing.client_user_id !== params.clientUserId ||
      existing.seller_id !== params.sellerId ||
      existing.status !== "draft"
    ) {
      throw new Error("Draft order not found");
    }
  } else {
    const { data: existingDraft } = await supabaseAdmin
      .from("seller_orders")
      .select("id")
      .eq("client_user_id", params.clientUserId)
      .eq("seller_id", params.sellerId)
      .eq("status", "draft")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    orderId = existingDraft?.id ?? null;
  }

  const orderPayload = {
    seller_id: params.sellerId,
    client_user_id: params.clientUserId,
    status: "draft",
    currency,
    subtotal_cents: shadow.subtotal_cents,
    delivery_fee_cents: shadow.delivery_fee_cents,
    service_fee_cents: shadow.service_fee_cents,
    total_cents: shadow.total_cents,
    country_code: params.countryCode ?? null,
    pickup_location_id: params.pickupLocationId ?? null,
    dropoff_location_id: params.dropoffLocationId ?? null,
    notes: params.notes?.trim() || null,
    checkout_shadow: shadow,
    updated_at: new Date().toISOString(),
  };

  if (orderId) {
    const { error: updateError } = await supabaseAdmin
      .from("seller_orders")
      .update(orderPayload)
      .eq("id", orderId)
      .eq("client_user_id", params.clientUserId)
      .eq("status", "draft");

    if (updateError) throw new Error(updateError.message);
  } else {
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("seller_orders")
      .insert(orderPayload)
      .select("id")
      .single();

    if (insertError) throw new Error(insertError.message);
    orderId = inserted.id as string;
  }

  const { error: deleteError } = await supabaseAdmin
    .from("seller_order_items")
    .delete()
    .eq("order_id", orderId);

  if (deleteError) throw new Error(deleteError.message);

  const { error: itemsError } = await supabaseAdmin.from("seller_order_items").insert(
    lineItems.map((item) => ({
      order_id: orderId,
      product_id: item.product_id,
      title: item.title,
      price_cents: item.price_cents,
      quantity: item.quantity,
      currency: item.currency,
    }))
  );

  if (itemsError) throw new Error(itemsError.message);

  const order = await getClientDraftOrder(supabaseAdmin, {
    clientUserId: params.clientUserId,
    orderId,
  });

  if (!order) throw new Error("Failed to load draft order");

  await persistMarketplaceDeliveryShadow(supabaseAdmin, {
    orderId: order.id,
    sellerId: params.sellerId,
    pickupLocationId: params.pickupLocationId ?? null,
    dropoffLocationId: params.dropoffLocationId ?? null,
    countryCode: params.countryCode ?? null,
  });

  return (
    (await getClientDraftOrder(supabaseAdmin, {
      clientUserId: params.clientUserId,
      orderId: order.id,
    })) ?? order
  );
}

export async function runMarketplaceCheckoutShadow(
  supabaseAdmin: SupabaseClient,
  params: {
    clientUserId: string;
    orderId: string;
  }
): Promise<{ order: MarketplaceOrderRow; shadow: MarketplaceCheckoutShadow }> {
  const order = await getClientDraftOrder(supabaseAdmin, {
    clientUserId: params.clientUserId,
    orderId: params.orderId,
  });

  if (!order || order.status !== "draft") {
    throw new Error("Draft order not found");
  }

  const shadow = computeMarketplaceCheckoutShadow(
    (order.items ?? []).map((item) => ({
      price_cents: item.price_cents,
      quantity: item.quantity,
    }))
  );

  const nextStatus = shadow.checkout_enabled ? "pending_checkout" : "draft";

  const { error } = await supabaseAdmin
    .from("seller_orders")
    .update({
      status: nextStatus,
      subtotal_cents: shadow.subtotal_cents,
      delivery_fee_cents: shadow.delivery_fee_cents,
      service_fee_cents: shadow.service_fee_cents,
      total_cents: shadow.total_cents,
      checkout_shadow: shadow,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .eq("client_user_id", params.clientUserId)
    .eq("status", "draft");

  if (error) throw new Error(error.message);

  const refreshed = await getClientDraftOrder(supabaseAdmin, {
    clientUserId: params.clientUserId,
    orderId: order.id,
  });

  if (!refreshed) throw new Error("Failed to refresh order");

  await persistMarketplaceDeliveryShadow(supabaseAdmin, {
    orderId: refreshed.id,
    sellerId: refreshed.seller_id,
    pickupLocationId: refreshed.pickup_location_id ?? null,
    dropoffLocationId: refreshed.dropoff_location_id ?? null,
    countryCode: refreshed.country_code ?? null,
  });

  const withDeliveryShadow = await getClientDraftOrder(supabaseAdmin, {
    clientUserId: params.clientUserId,
    orderId: refreshed.id,
  });

  return {
    order: withDeliveryShadow ?? refreshed,
    shadow,
  };
}
