import type { SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";
import { PAYMENT_METADATA_SCHEMA_VERSION } from "@/lib/requirePaymentIntentSucceeded";
import { buildStripeCheckoutLineItems } from "@/lib/stripeCheckoutBreakdown";
import {
  type MarketplaceCheckoutShadow,
} from "@/lib/marketplaceCheckout";
import {
  getClientDraftOrder,
  type MarketplaceOrderRow,
} from "@/lib/marketplaceOrderService";
import { isMarketplaceCheckoutLiveEnvEnabled } from "@/lib/marketplaceLiveCheckout";
import { loadMarketplaceServiceFeeConfig } from "@/lib/serviceFeeConfigLoader";
import { buildStripeCheckoutReturnUrls } from "@/lib/productionSite";
import { quoteMarketplaceSot } from "@/lib/pricingEngine";
import { assertStripeCheckoutAllowed } from "@/lib/paymentProviderRouting";
import { resolveMarketplaceUnitPriceCents } from "@/lib/marketplaceOrderService";

type ApprovedSellerRow = {
  id: string;
  user_id: string;
  status: string;
  business_name: string;
  country_code: string | null;
  city: string | null;
  stripe_account_id: string | null;
  stripe_details_submitted: boolean | null;
  stripe_charges_enabled: boolean | null;
  stripe_payouts_enabled: boolean | null;
};

function normalizeCurrency(value: unknown): string {
  const code = String(value ?? "USD")
    .trim()
    .toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "USD";
}

function buildMarketplaceCheckoutUrls(sellerOrderId: string) {
  const { successUrl, cancelUrl } = buildStripeCheckoutReturnUrls({
    successQuery: { seller_order_id: sellerOrderId },
    cancelQuery: { seller_order_id: sellerOrderId },
  });
  return { successUrl, cancelUrl };
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
    .select(
      "id,user_id,status,business_name,country_code,city,stripe_account_id,stripe_details_submitted,stripe_charges_enabled,stripe_payouts_enabled"
    )
    .eq("id", sellerId)
    .eq("status", "approved")
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new Error("Seller not approved");
  return data as ApprovedSellerRow;
}

function assertSellerStripeConnectReady(seller: ApprovedSellerRow): void {
  const destination = String(seller.stripe_account_id ?? "").trim();
  const ready =
    Boolean(seller.stripe_details_submitted) &&
    Boolean(seller.stripe_charges_enabled) &&
    Boolean(seller.stripe_payouts_enabled) &&
    /^acct_[A-Za-z0-9]+$/.test(destination);
  if (!ready) {
    throw new Error("seller_stripe_connect_not_ready");
  }
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
    .select("id,price_cents,promo_price_cents,active,stock_qty")
    .eq("seller_id", order.seller_id)
    .in("id", productIds)
    .eq("active", true);

  if (error) throw new Error(error.message);

  const activeById = new Map(
    (products ?? []).map((row) => [String(row.id), row])
  );
  for (const item of items) {
    const product = item.product_id ? activeById.get(String(item.product_id)) : null;
    if (!item.product_id || !product) {
      throw new Error(`Inactive or invalid product: ${item.title}`);
    }
    if (product.stock_qty != null && Number(product.stock_qty) < item.quantity) {
      throw new Error(`Insufficient stock for product: ${item.title}`);
    }
  }

  const serviceFeeConfig = await loadMarketplaceServiceFeeConfig(supabaseAdmin, {
    countryCode: order.country_code ?? undefined,
    region: order.region_code ?? undefined,
  });

  // Always price from live catalog — never trust stale cart line prices.
  // Phase 5F — PE exclusive SoT.
  const pe = quoteMarketplaceSot(
    items.map((item) => {
      const product = activeById.get(String(item.product_id))!;
      return {
        price_cents: resolveMarketplaceUnitPriceCents(product),
        quantity: item.quantity,
      };
    }),
    {
      deliveryFeeCents: order.delivery_fee_cents ?? undefined,
      serviceFeeConfig,
    }
  );
  const { pe: _peMeta, ...totals } = pe;
  return {
    ...totals,
    pricing_engine_version: "marketplace_checkout_shadow_v2",
  } satisfies MarketplaceCheckoutShadow;
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
  assertSellerStripeConnectReady(seller);

  const stripeGate = assertStripeCheckoutAllowed(
    seller.country_code ?? order.country_code ?? "US"
  );
  if (stripeGate.ok === false) {
    throw new Error(stripeGate.message);
  }

  const totalsBase = await assertActiveOrderProducts(supabaseAdmin, order);

  const totals: MarketplaceCheckoutShadow = {
    subtotal_cents: totalsBase.subtotal_cents,
    delivery_fee_cents: totalsBase.delivery_fee_cents,
    service_fee_cents: totalsBase.service_fee_cents,
    service_fee_pct: totalsBase.service_fee_pct,
    service_fee_enabled: totalsBase.service_fee_enabled,
    service_fee_fixed_cents: totalsBase.service_fee_fixed_cents,
    total_cents: totalsBase.total_cents,
    checkout_enabled: totalsBase.checkout_enabled,
    pricing_engine_version: "marketplace_checkout_shadow_v2",
    message: totalsBase.message,
  };

  if (totals.total_cents <= 0) throw new Error("Invalid order total");

  // Phase 4: freeze marketplace commission at checkout (write-once).
  const { snapshotOrderCommission } = await import("@/lib/commission/commissionEngine");
  const snap = await snapshotOrderCommission(supabaseAdmin, {
    orderKind: "marketplace",
    orderId: order.id,
    partnerType: "seller",
    partnerUserId: seller.user_id,
    service: "marketplace",
    currency: order.currency ?? "USD",
    countryCode: seller.country_code ?? order.country_code ?? null,
    city: seller.city ?? null,
  });
  if (!snap.ok) {
    console.error("[commission-engine] marketplace snapshot failed", {
      seller_order_id: order.id,
      error: snap.error,
    });
  }

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
