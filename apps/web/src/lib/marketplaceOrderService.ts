import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeMarketplaceCheckoutShadow,
  type MarketplaceCheckoutShadow,
} from "@/lib/marketplaceCheckout";
import { persistMarketplaceDeliveryShadow } from "@/lib/marketplaceDeliveryShadow";
import { loadMarketplaceServiceFeeConfig } from "@/lib/serviceFeeConfigLoader";
import { resolveMmdPlusCheckoutBenefits } from "@/lib/mmdPlus/mmdPlusEngine";
import {
  isLikelyFirstOrder,
  resolveMarketingOffers,
  userHasActiveMmdPlus,
} from "@/lib/marketing/marketingEngine";

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
  stripe_checkout_session_id?: string | null;
  stripe_payment_intent_id?: string | null;
  paid_at?: string | null;
  payment_status?: string | null;
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
  stock_qty?: number | null;
  promo_price_cents?: number | null;
};

export type MarketplaceDraftMergeItem = {
  product_id: string;
  quantity: number;
};

/**
 * Merge draft cart items by product_id.
 * Incoming quantities overwrite matching products; products only in existing stay.
 * With replaceItems=true, only incoming items are kept.
 */
export function mergeMarketplaceDraftItems(
  existing: MarketplaceDraftMergeItem[],
  incoming: MarketplaceDraftMergeItem[],
  replaceItems = false
): MarketplaceDraftMergeItem[] {
  if (replaceItems) {
    return incoming
      .map((item) => ({
        product_id: item.product_id,
        quantity: Math.max(1, Math.round(item.quantity)),
      }))
      .filter((item) => item.product_id);
  }

  const byProduct = new Map<string, number>();
  for (const item of existing) {
    if (!item.product_id) continue;
    byProduct.set(item.product_id, Math.max(1, Math.round(item.quantity)));
  }
  for (const item of incoming) {
    if (!item.product_id) continue;
    byProduct.set(item.product_id, Math.max(1, Math.round(item.quantity)));
  }

  return [...byProduct.entries()].map(([product_id, quantity]) => ({
    product_id,
    quantity,
  }));
}

export function resolveMarketplaceUnitPriceCents(product: {
  price_cents: number;
  promo_price_cents?: number | null;
}): number {
  const base = Math.max(0, Math.round(Number(product.price_cents) || 0));
  const promo =
    product.promo_price_cents == null
      ? null
      : Math.max(0, Math.round(Number(product.promo_price_cents) || 0));
  if (promo != null && promo < base) return promo;
  return base;
}

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
      "id,seller_id,title,description,price_cents,currency,category,image_paths,active,stock_qty,options_json,variants_json,promo_price_cents,created_at,updated_at"
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
  sellerId: string,
  opts?: { requireAcceptingOrders?: boolean }
) {
  const { data, error } = await supabaseAdmin
    .from("sellers")
    .select("id,business_name,country_code,city,status,is_accepting_orders")
    .eq("id", sellerId)
    .eq("status", "approved")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  if (
    opts?.requireAcceptingOrders &&
    Object.prototype.hasOwnProperty.call(data, "is_accepting_orders") &&
    data.is_accepting_orders === false
  ) {
    throw new Error("Seller is not accepting orders");
  }

  return data;
}

export async function loadApprovedSellers(supabaseAdmin: SupabaseClient) {
  const { data, error } = await supabaseAdmin
    .from("sellers")
    .select(
      "id,business_name,country_code,city,address,region_code,status,is_accepting_orders,created_at"
    )
    .eq("status", "approved")
    .order("business_name", { ascending: true })
    .limit(200);

  if (error) throw new Error(error.message);

  const sellers = data ?? [];
  if (sellers.length === 0) return [];

  const sellerIds = sellers.map((row) => row.id);
  const { data: productRows, error: productError } = await supabaseAdmin
    .from("seller_products")
    .select("seller_id")
    .in("seller_id", sellerIds)
    .eq("active", true);

  if (productError) throw new Error(productError.message);

  const counts = new Map<string, number>();
  for (const row of productRows ?? []) {
    const id = String(row.seller_id);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  return sellers.map((seller) => ({
    ...seller,
    active_product_count: counts.get(String(seller.id)) ?? 0,
  }));
}

const ORDER_SELECT =
  "id,seller_id,client_user_id,status,currency,subtotal_cents,delivery_fee_cents,service_fee_cents,total_cents,country_code,region_code,notes,checkout_shadow,pickup_location_id,dropoff_location_id,seller_pickup_address,delivery_status_shadow,delivery_quote_shadow,estimated_distance_miles,estimated_minutes,driver_earning_shadow_cents,platform_margin_shadow_cents,dispatch_shadow,stripe_checkout_session_id,stripe_payment_intent_id,paid_at,payment_status,created_at,updated_at";

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
    replace_items?: boolean;
  }
): Promise<MarketplaceOrderRow> {
  if (params.items.length === 0 && !params.replace_items) {
    throw new Error("Cart is empty");
  }

  const seller = await assertApprovedSeller(supabaseAdmin, params.sellerId, {
    requireAcceptingOrders: true,
  });
  if (!seller) throw new Error("Seller not available");

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

  let orderId = params.orderId ?? null;
  let existingItems: MarketplaceDraftMergeItem[] = [];

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

  if (orderId && !params.replace_items) {
    const { data: existingRows, error: existingItemsError } = await supabaseAdmin
      .from("seller_order_items")
      .select("product_id,quantity")
      .eq("order_id", orderId);

    if (existingItemsError) throw new Error(existingItemsError.message);
    existingItems = ((existingRows ?? []) as Array<{ product_id: string | null; quantity: number }>)
      .filter((row) => row.product_id)
      .map((row) => ({
        product_id: String(row.product_id),
        quantity: Number(row.quantity) || 1,
      }));
  }

  const mergedItems = mergeMarketplaceDraftItems(
    existingItems,
    params.items,
    Boolean(params.replace_items)
  );

  if (mergedItems.length === 0) {
    throw new Error("Cart is empty");
  }

  const productIds = mergedItems.map((item) => item.product_id);
  const { data: products, error: productsError } = await supabaseAdmin
    .from("seller_products")
    .select("id,seller_id,title,price_cents,currency,active,stock_qty,promo_price_cents")
    .in("id", productIds)
    .eq("seller_id", params.sellerId)
    .eq("active", true);

  if (productsError) throw new Error(productsError.message);

  const productMap = new Map(
    ((products as ProductRow[]) ?? []).map((product) => [product.id, product])
  );

  const lineItems = mergedItems.map((item) => {
    const product = productMap.get(item.product_id);
    if (!product) throw new Error(`Invalid product: ${item.product_id}`);
    const quantity = Math.max(1, Math.round(item.quantity));
    if (product.stock_qty != null && product.stock_qty < quantity) {
      throw new Error(`Insufficient stock for product: ${product.title}`);
    }
    return {
      product_id: product.id,
      title: product.title,
      price_cents: resolveMarketplaceUnitPriceCents(product),
      quantity,
      currency: product.currency,
    };
  });

  const serviceFeeConfig = await loadMarketplaceServiceFeeConfig(supabaseAdmin, {
    countryCode: params.countryCode ?? undefined,
  });

  const shadowBase = computeMarketplaceCheckoutShadow(
    lineItems.map((item) => ({
      price_cents: item.price_cents,
      quantity: item.quantity,
    })),
    { serviceFeeConfig }
  );

  const [hasPlus, firstOrder] = await Promise.all([
    userHasActiveMmdPlus(supabaseAdmin, params.clientUserId),
    isLikelyFirstOrder(supabaseAdmin, params.clientUserId, "marketplace"),
  ]);
  const marketing = await resolveMarketingOffers(supabaseAdmin, {
    userId: params.clientUserId,
    service: "marketplace",
    subtotalCents: shadowBase.subtotal_cents,
    deliveryFeeCents: shadowBase.delivery_fee_cents,
    countryCode: params.countryCode ?? null,
    partnerUserId: params.sellerId,
    hasMmdPlus: hasPlus,
    isFirstOrder: firstOrder,
  });
  const marketingOrder =
    marketing.ok || !marketing.fail_closed ? marketing.order_discount_cents : 0;
  const marketingFee =
    marketing.ok || !marketing.fail_closed
      ? marketing.delivery_fee_discount_cents
      : 0;

  const mmdPlus = await resolveMmdPlusCheckoutBenefits(supabaseAdmin, {
    userId: params.clientUserId,
    service: "marketplace",
    subtotalCents: Math.max(0, shadowBase.subtotal_cents - marketingOrder),
    deliveryFeeCents: Math.max(0, shadowBase.delivery_fee_cents - marketingFee),
  });
  const deliveryFeeCents = Math.max(
    0,
    shadowBase.delivery_fee_cents -
      marketingFee -
      mmdPlus.delivery_fee_discount_cents
  );
  const subtotalCents = Math.max(
    0,
    shadowBase.subtotal_cents - marketingOrder - mmdPlus.order_discount_cents
  );
  const shadow = {
    ...shadowBase,
    subtotal_cents: subtotalCents,
    delivery_fee_cents: deliveryFeeCents,
    total_cents:
      subtotalCents + deliveryFeeCents + shadowBase.service_fee_cents,
    marketing: {
      order_discount_cents: marketingOrder,
      delivery_fee_discount_cents: marketingFee,
      applied: marketing.applied,
    },
    mmd_plus: {
      delivery_fee_discount_cents: mmdPlus.delivery_fee_discount_cents,
      order_discount_cents: mmdPlus.order_discount_cents,
      active: mmdPlus.active,
    },
  };

  const currency = lineItems[0]?.currency ?? "USD";

  const orderPayload = {
    seller_id: params.sellerId,
    client_user_id: params.clientUserId,
    status: "draft",
    currency,
    subtotal_cents: shadow.subtotal_cents,
    delivery_fee_cents: shadow.delivery_fee_cents,
    service_fee_cents: shadow.service_fee_cents,
    service_fee_pct: shadow.service_fee_pct,
    service_fee_enabled: shadow.service_fee_enabled,
    service_fee_fixed_cents: shadow.service_fee_fixed_cents,
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

  const items = order.items ?? [];
  if (items.length === 0) {
    throw new Error("Cart is empty");
  }

  const productIds = items
    .map((item) => item.product_id)
    .filter((id): id is string => Boolean(id));

  const { data: products, error: productsError } = await supabaseAdmin
    .from("seller_products")
    .select("id,price_cents,promo_price_cents,active,stock_qty")
    .in("id", productIds)
    .eq("seller_id", order.seller_id)
    .eq("active", true);

  if (productsError) throw new Error(productsError.message);

  const productMap = new Map(
    ((products as ProductRow[]) ?? []).map((product) => [product.id, product])
  );

  for (const item of items) {
    const productId = item.product_id;
    if (!productId) throw new Error("Order item missing product");
    const product = productMap.get(productId);
    if (!product) throw new Error(`Invalid product: ${productId}`);
    if (product.stock_qty != null && product.stock_qty < item.quantity) {
      throw new Error(`Insufficient stock for product: ${item.title}`);
    }

    const livePrice = resolveMarketplaceUnitPriceCents(product);
    if (livePrice !== item.price_cents) {
      const { error: priceError } = await supabaseAdmin
        .from("seller_order_items")
        .update({ price_cents: livePrice })
        .eq("id", item.id)
        .eq("order_id", order.id);
      if (priceError) throw new Error(priceError.message);
      item.price_cents = livePrice;
    }
  }

  const serviceFeeConfig = await loadMarketplaceServiceFeeConfig(supabaseAdmin, {
    countryCode: order.country_code ?? undefined,
    region: order.region_code ?? undefined,
  });

  const shadowBase = computeMarketplaceCheckoutShadow(
    items.map((item) => ({
      price_cents: item.price_cents,
      quantity: item.quantity,
    })),
    {
      deliveryFeeCents: order.delivery_fee_cents,
      serviceFeeConfig,
    }
  );

  const [hasPlusPreview, firstOrderPreview] = order.client_user_id
    ? await Promise.all([
        userHasActiveMmdPlus(supabaseAdmin, order.client_user_id),
        isLikelyFirstOrder(supabaseAdmin, order.client_user_id, "marketplace"),
      ])
    : [false, false];
  const marketing = order.client_user_id
    ? await resolveMarketingOffers(supabaseAdmin, {
        userId: order.client_user_id,
        service: "marketplace",
        subtotalCents: shadowBase.subtotal_cents,
        deliveryFeeCents: shadowBase.delivery_fee_cents,
        countryCode: order.country_code ?? null,
        partnerUserId: order.seller_id,
        hasMmdPlus: hasPlusPreview,
        isFirstOrder: firstOrderPreview,
      })
    : {
        ok: true,
        order_discount_cents: 0,
        delivery_fee_discount_cents: 0,
        cashback_cents: 0,
        points_bonus: 0,
        applied: [] as Array<Record<string, unknown>>,
        rejected: [] as Array<Record<string, unknown>>,
      };
  const marketingOrder =
    marketing.ok || !("fail_closed" in marketing && marketing.fail_closed)
      ? marketing.order_discount_cents
      : 0;
  const marketingFee =
    marketing.ok || !("fail_closed" in marketing && marketing.fail_closed)
      ? marketing.delivery_fee_discount_cents
      : 0;

  const mmdPlus = order.client_user_id
    ? await resolveMmdPlusCheckoutBenefits(supabaseAdmin, {
        userId: order.client_user_id,
        service: "marketplace",
        subtotalCents: Math.max(0, shadowBase.subtotal_cents - marketingOrder),
        deliveryFeeCents: Math.max(0, shadowBase.delivery_fee_cents - marketingFee),
      })
    : null;
  const deliveryFeeCents = Math.max(
    0,
    shadowBase.delivery_fee_cents -
      marketingFee -
      (mmdPlus?.delivery_fee_discount_cents ?? 0)
  );
  const subtotalCents = Math.max(
    0,
    shadowBase.subtotal_cents -
      marketingOrder -
      (mmdPlus?.order_discount_cents ?? 0)
  );
  const shadow = {
    ...shadowBase,
    subtotal_cents: subtotalCents,
    delivery_fee_cents: deliveryFeeCents,
    total_cents: subtotalCents + deliveryFeeCents + shadowBase.service_fee_cents,
    marketing: {
      order_discount_cents: marketingOrder,
      delivery_fee_discount_cents: marketingFee,
      applied: marketing.applied,
    },
    mmd_plus: mmdPlus
      ? {
          delivery_fee_discount_cents: mmdPlus.delivery_fee_discount_cents,
          order_discount_cents: mmdPlus.order_discount_cents,
          active: mmdPlus.active,
        }
      : undefined,
  };

  const nextStatus = shadow.checkout_enabled ? "pending_checkout" : "draft";

  const { error } = await supabaseAdmin
    .from("seller_orders")
    .update({
      status: nextStatus,
      subtotal_cents: shadow.subtotal_cents,
      delivery_fee_cents: shadow.delivery_fee_cents,
      service_fee_cents: shadow.service_fee_cents,
      service_fee_pct: shadow.service_fee_pct,
      service_fee_enabled: shadow.service_fee_enabled,
      service_fee_fixed_cents: shadow.service_fee_fixed_cents,
      total_cents: shadow.total_cents,
      checkout_shadow: shadow,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .eq("client_user_id", params.clientUserId)
    .eq("status", "draft");

  if (error) throw new Error(error.message);

  // Phase 7.1: reserve when checkout becomes financially engaging.
  if (nextStatus === "pending_checkout") {
    try {
      const { reserveAndAttachMarketing } = await import(
        "@/lib/marketing/marketingCheckoutLifecycle"
      );
      const { userHasActiveMmdPlus, isLikelyFirstOrder } = await import(
        "@/lib/marketing/marketingEngine"
      );
      const [hasPlus, firstOrder] = await Promise.all([
        userHasActiveMmdPlus(supabaseAdmin, params.clientUserId),
        isLikelyFirstOrder(supabaseAdmin, params.clientUserId, "marketplace"),
      ]);
      const marketingAttach = await reserveAndAttachMarketing(supabaseAdmin, {
        kind: "marketplace",
        entityId: order.id,
        userId: params.clientUserId,
        subtotalCents: Number(shadowBase.subtotal_cents ?? shadow.subtotal_cents ?? 0),
        deliveryFeeCents: Number(
          shadowBase.delivery_fee_cents ?? shadow.delivery_fee_cents ?? 0
        ),
        countryCode: order.country_code ?? null,
        partnerUserId: order.seller_id,
        hasMmdPlus: hasPlus,
        isFirstOrder: firstOrder,
      });
      if (!marketingAttach.ok && marketingAttach.fail_closed) {
        await supabaseAdmin
          .from("seller_orders")
          .update({
            status: "draft",
            updated_at: new Date().toISOString(),
          })
          .eq("id", order.id);
        throw new Error(
          marketingAttach.error ?? "Impossible de réserver la promotion"
        );
      }
      // Enrich checkout snapshot with funding breakdown (immutable at capture).
      const fundingShadow = {
        ...shadow,
        marketing_reservation_id: marketingAttach.marketing_reservation_id,
        marketing_discount_cents: marketingAttach.marketing_discount_cents,
        marketing_campaign_ids: marketingAttach.marketing_campaign_ids,
        financial_snapshot: {
          engine: "marketing_v1",
          mmd_funded_cents: Math.max(
            0,
            Number(
              marketingAttach.reserve.resolve?.applied?.[0]?.mmd_funded_cents ??
                marketingAttach.marketing_discount_cents
            )
          ),
          partner_funded_cents: Math.max(
            0,
            Number(
              marketingAttach.reserve.resolve?.applied?.[0]?.partner_funded_cents ?? 0
            )
          ),
          client_paid_cents: shadow.total_cents,
          reserved_at: new Date().toISOString(),
        },
      };
      await supabaseAdmin
        .from("seller_orders")
        .update({
          checkout_shadow: fundingShadow,
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);
    } catch (e) {
      if (
        e instanceof Error &&
        /Impossible de réserver|marketing_reserve|fail_closed/i.test(e.message)
      ) {
        throw e;
      }
      console.warn(
        "[marketing] marketplace reserve fail-open",
        e instanceof Error ? e.message : e
      );
    }
  }

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
