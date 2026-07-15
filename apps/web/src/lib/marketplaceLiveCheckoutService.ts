import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { PAYMENT_METADATA_SCHEMA_VERSION } from "@/lib/requirePaymentIntentSucceeded";
import { buildStripeCheckoutLineItems } from "@/lib/stripeCheckoutBreakdown";
import {
  computeMarketplaceCheckoutShadow,
  type MarketplaceCheckoutShadow,
} from "@/lib/marketplaceCheckout";
import {
  getClientDraftOrder,
  type MarketplaceOrderRow,
} from "@/lib/marketplaceOrderService";
import { isMarketplaceCheckoutLiveEnvEnabled } from "@/lib/marketplaceLiveCheckout";
import { loadMarketplaceServiceFeeConfig } from "@/lib/serviceFeeConfigLoader";

type ApprovedSellerRow = {
  id: string;
  status: string;
  business_name: string;
};

function normalizeCurrency(value: unknown): string {
  const code = String(value ?? "USD")
    .trim()
    .toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "USD";
}

function buildPublicBaseUrl(): string {
  const candidate =
    process.env.NEXT_PUBLIC_WEB_BASE_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    "https://www.mmddelivery.com";
  return candidate.replace(/\/+$/, "");
}

function buildMarketplaceCheckoutUrls(sellerOrderId: string) {
  const base = buildPublicBaseUrl();
  const successBase =
    process.env.STRIPE_CHECKOUT_SUCCESS_URL || `${base}/stripe/success`;
  const cancelBase =
    process.env.STRIPE_CHECKOUT_CANCEL_URL || `${base}/stripe/cancel`;

  return {
    successUrl: `${successBase.replace(/\/$/, "")}?seller_order_id=${encodeURIComponent(sellerOrderId)}`,
    cancelUrl: `${cancelBase.replace(/\/$/, "")}?seller_order_id=${encodeURIComponent(sellerOrderId)}`,
  };
}

function paymentIntentIdFromUnknown(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && "id" in value) {
    const maybeId = (value as { id?: unknown }).id;
    if (typeof maybeId === "string" && maybeId.trim()) return maybeId.trim();
  }
  return null;
}

async function assertApprovedSeller(
  supabaseAdmin: SupabaseClient,
  sellerId: string
): Promise<ApprovedSellerRow> {
  const { data, error } = await supabaseAdmin
    .from("sellers")
    .select("id,status,business_name")
    .eq("id", sellerId)
    .eq("status", "approved")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Seller not approved");
  return data as ApprovedSellerRow;
}

async function assertActiveOrderProducts(
  supabaseAdmin: SupabaseClient,
  order: MarketplaceOrderRow
): Promise<MarketplaceCheckoutShadow> {
  const items = order.items ?? [];
  if (items.length === 0) throw new Error("Cart is empty");

  const productIds = [
    ...new Set(items.map((item) => String(item.product_id ?? "")).filter(Boolean)),
  ];

  const { data: products, error } = await supabaseAdmin
    .from("seller_products")
    .select("id,price_cents,active")
    .eq("seller_id", order.seller_id)
    .in("id", productIds)
    .eq("active", true);

  if (error) throw new Error(error.message);

  const activeById = new Map(
    (products ?? []).map((row) => [String(row.id), Number(row.price_cents)])
  );
  for (const item of items) {
    if (!item.product_id || !activeById.has(item.product_id)) {
      throw new Error(`Inactive or invalid product: ${item.title}`);
    }
  }

  const serviceFeeConfig = await loadMarketplaceServiceFeeConfig(supabaseAdmin, {
    countryCode: order.country_code ?? undefined,
    region: order.region_code ?? undefined,
  });

  // Always price from live catalog — never trust stale cart line prices.
  return computeMarketplaceCheckoutShadow(
    items.map((item) => ({
      price_cents: activeById.get(String(item.product_id)) ?? 0,
      quantity: item.quantity,
    })),
    {
      deliveryFeeCents: order.delivery_fee_cents,
      serviceFeeConfig,
    }
  );
}

export async function prepareMarketplaceLiveCheckoutOrder(
  supabaseAdmin: SupabaseClient,
  params: {
    clientUserId: string;
    orderId: string;
    platformCheckoutEnabled: boolean;
    marketplaceCheckoutLiveEnabled: boolean;
  }
): Promise<{ order: MarketplaceOrderRow; totals: MarketplaceCheckoutShadow; seller: ApprovedSellerRow }> {
  if (!params.marketplaceCheckoutLiveEnabled) {
    throw new Error("marketplace_live_checkout_disabled");
  }

  if (!isMarketplaceCheckoutLiveEnvEnabled()) {
    throw new Error("marketplace_live_checkout_disabled");
  }

  if (!params.platformCheckoutEnabled) {
    throw new Error("platform_checkout_disabled");
  }

  const order = await getClientDraftOrder(supabaseAdmin, {
    clientUserId: params.clientUserId,
    orderId: params.orderId,
  });

  if (!order) throw new Error("Draft order not found");
  if (order.client_user_id !== params.clientUserId) throw new Error("Order access denied");
  if (!["draft", "pending_checkout"].includes(order.status)) {
    throw new Error("Order is not eligible for live checkout");
  }
  if (order.payment_status === "paid" || order.status === "paid") {
    throw new Error("Order already paid");
  }

  const seller = await assertApprovedSeller(supabaseAdmin, order.seller_id);
  const totals = await assertActiveOrderProducts(supabaseAdmin, order);

  if (totals.total_cents <= 0) throw new Error("Invalid order total");

  return { order, totals, seller };
}

export async function createMarketplaceLiveCheckoutSession(
  supabaseAdmin: SupabaseClient,
  params: {
    clientUserId: string;
    orderId: string;
    platformCheckoutEnabled: boolean;
    marketplaceCheckoutLiveEnabled: boolean;
  }
): Promise<{
  order: MarketplaceOrderRow;
  checkoutUrl: string;
  stripeCheckoutSessionId: string;
  stripePaymentIntentId: string | null;
  totals: MarketplaceCheckoutShadow;
}> {
  const { order, totals, seller } = await prepareMarketplaceLiveCheckoutOrder(
    supabaseAdmin,
    params
  );

  const currency = normalizeCurrency(order.currency).toLowerCase();
  const { successUrl, cancelUrl } = buildMarketplaceCheckoutUrls(order.id);

  const existingSessionId = String(order.stripe_checkout_session_id ?? "").trim();
  if (existingSessionId) {
    try {
      const existing = await stripe.checkout.sessions.retrieve(existingSessionId);
      const existingAmount = Number(existing.amount_total ?? NaN);
      const existingCurrency = String(existing.currency ?? "")
        .trim()
        .toLowerCase();
      if (
        existing.status === "open" &&
        existing.url &&
        existing.payment_status !== "paid" &&
        existingAmount === totals.total_cents &&
        existingCurrency === currency
      ) {
        return {
          order,
          checkoutUrl: existing.url,
          stripeCheckoutSessionId: existing.id,
          stripePaymentIntentId: paymentIntentIdFromUnknown(existing.payment_intent),
          totals,
        };
      }
    } catch {
      // create a fresh session below
    }
  }

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: order.id,
    customer_email: undefined,
    line_items: buildStripeCheckoutLineItems({
      currency,
      productName: `MMD Marketplace — ${seller.business_name}`,
      breakdown: {
        subtotalCents: totals.subtotal_cents,
        deliveryFeeCents: totals.delivery_fee_cents,
        serviceFeeCents: totals.service_fee_cents,
        totalCents: totals.total_cents,
      },
    }),
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      metadata_schema_version: PAYMENT_METADATA_SCHEMA_VERSION,
      service_type: "marketplace",
      module: "marketplace",
      seller_order_id: order.id,
      seller_id: order.seller_id,
      client_user_id: params.clientUserId,
      user_id: params.clientUserId,
    },
    payment_intent_data: {
      metadata: {
        metadata_schema_version: PAYMENT_METADATA_SCHEMA_VERSION,
        service_type: "marketplace",
        module: "marketplace",
        seller_order_id: order.id,
        seller_id: order.seller_id,
        client_user_id: params.clientUserId,
        user_id: params.clientUserId,
      },
    },
  });

  if (!session.url) throw new Error("Stripe session missing checkout URL");

  const paymentIntentId = paymentIntentIdFromUnknown(session.payment_intent);

  const { error: updateError } = await supabaseAdmin
    .from("seller_orders")
    .update({
      status: "pending_payment",
      payment_status: "pending",
      subtotal_cents: totals.subtotal_cents,
      delivery_fee_cents: totals.delivery_fee_cents,
      service_fee_cents: totals.service_fee_cents,
      service_fee_pct: totals.service_fee_pct,
      service_fee_enabled: totals.service_fee_enabled,
      service_fee_fixed_cents: totals.service_fee_fixed_cents,
      total_cents: totals.total_cents,
      checkout_shadow: totals,
      stripe_checkout_session_id: session.id,
      stripe_payment_intent_id: paymentIntentId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id)
    .eq("client_user_id", params.clientUserId)
    .in("status", ["draft", "pending_checkout", "pending_payment"]);

  if (updateError) throw new Error(updateError.message);

  const refreshed = await getClientDraftOrder(supabaseAdmin, {
    clientUserId: params.clientUserId,
    orderId: order.id,
  });

  if (!refreshed) throw new Error("Failed to refresh marketplace order");

  return {
    order: refreshed,
    checkoutUrl: session.url,
    stripeCheckoutSessionId: session.id,
    stripePaymentIntentId: paymentIntentId,
    totals,
  };
}
