import type { SupabaseClient } from "@supabase/supabase-js";
import { assertNoGuineaIsolatedLiveWrite } from "@/lib/guineaTestIsolation";
import type { MarketplaceOrderRow } from "@/lib/marketplaceOrderService";
import { notifyMarketplaceSellerNewPaidOrder } from "@/lib/marketplacePushNotifications";
import {
  releaseMarketplaceStockReservation,
  reserveMarketplaceStockForCheckout,
} from "@/lib/marketplaceStockService";
import { usesLocalMobileMoney } from "@/lib/paymentProviderRouting";

/**
 * Local (non-Stripe) marketplace checkout for GN / SN / CI.
 *
 * - `cash`: order is confirmed for the seller; payment stays `pending_cash`
 *   (no wallet / Stripe money movement). No delivery job is created here — the
 *   seller accepts first, dispatch follows the existing seller flow. The seller
 *   later confirms the cash via `collectMarketplaceOrderCash`
 *   (`pending_cash` -> `cash_collected`, allowed while the order is
 *   confirmed / accepted / preparing / ready / out_for_delivery / delivered / fulfilled).
 * - `orange_money`: order is only prepared (`pending_checkout` / `unpaid`) for
 *   `POST /api/payments/initiate` with `entity_type = "seller_order"`.
 *
 * US / Stripe markets are rejected (`marketplace_local_checkout_not_available`).
 */

export type MarketplaceLocalPaymentMethod = "cash" | "orange_money";

export const MARKETPLACE_LOCAL_PAYMENT_METHODS: readonly MarketplaceLocalPaymentMethod[] = [
  "cash",
  "orange_money",
];

export type PlaceMarketplaceLocalOrderResult =
  | { ok: true; order: MarketplaceOrderRow; charge_path: "cash" }
  | {
      ok: true;
      order: MarketplaceOrderRow;
      charge_path: "orange_money";
      next: "payments_initiate";
    };

type LocalSellerRow = {
  id: string;
  user_id: string | null;
  status: string;
  business_name?: string | null;
  country_code: string | null;
  is_accepting_orders?: boolean | null;
};

export function isMarketplaceLocalPaymentMethod(
  value: unknown
): value is MarketplaceLocalPaymentMethod {
  return value === "cash" || value === "orange_money";
}

function normalizeCountry(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * `seller_orders` has no `payment_method` column (see migrations), so the chosen
 * local method is persisted inside `checkout_shadow` (jsonb).
 */
function buildLocalCheckoutShadow(
  order: MarketplaceOrderRow,
  paymentMethod: MarketplaceLocalPaymentMethod,
  nowIso: string
): Record<string, unknown> {
  return {
    ...asRecord(order.checkout_shadow),
    payment_method: paymentMethod,
    local_checkout: {
      payment_method: paymentMethod,
      placed_at: nowIso,
    },
  };
}

function mapUpdateError(message: string): Error {
  // seller_orders.payment_status CHECK does not yet allow `pending_cash` (placement) or
  // `cash_collected` (POST /api/marketplace/orders/cash-collected) until
  // supabase/pending/20261223120000_marketplace_local_cash.sql is applied.
  if (/payment_status_check|pending_cash/i.test(message)) {
    return new Error("marketplace_cash_schema_not_ready");
  }
  return new Error(message);
}

export async function placeMarketplaceLocalOrder(
  supabaseAdmin: SupabaseClient,
  params: {
    clientUserId: string;
    orderId: string;
    paymentMethod: MarketplaceLocalPaymentMethod;
  }
): Promise<PlaceMarketplaceLocalOrderResult> {
  const { clientUserId, orderId, paymentMethod } = params;

  if (!isMarketplaceLocalPaymentMethod(paymentMethod)) {
    throw new Error("invalid_payment_method");
  }

  const { data: orderData, error: orderError } = await supabaseAdmin
    .from("seller_orders")
    .select("*")
    .eq("id", orderId)
    .eq("client_user_id", clientUserId)
    .maybeSingle();

  if (orderError) throw new Error(orderError.message);
  const order = orderData as MarketplaceOrderRow | null;
  if (!order || order.client_user_id !== clientUserId) {
    throw new Error("Order not found");
  }

  if (!["draft", "pending_checkout"].includes(String(order.status))) {
    throw new Error("Order is not eligible for local checkout");
  }
  if (order.payment_status === "paid") {
    throw new Error("Order already paid");
  }

  const { data: sellerData, error: sellerError } = await supabaseAdmin
    .from("sellers")
    .select("id,user_id,status,business_name,country_code,is_accepting_orders")
    .eq("id", order.seller_id)
    .maybeSingle();

  if (sellerError) throw new Error(sellerError.message);
  const seller = sellerData as LocalSellerRow | null;
  if (!seller || seller.status !== "approved") throw new Error("Seller not approved");
  if (seller.is_accepting_orders === false) throw new Error("Seller is not accepting orders");

  const countryCode = normalizeCountry(order.country_code) || normalizeCountry(seller.country_code);
  if (!countryCode || !usesLocalMobileMoney(countryCode)) {
    throw new Error("marketplace_local_checkout_not_available");
  }

  await assertNoGuineaIsolatedLiveWrite(supabaseAdmin, [clientUserId, seller.user_id]);

  const nowIso = new Date().toISOString();
  const checkoutShadow = buildLocalCheckoutShadow(order, paymentMethod, nowIso);
  const currency =
    countryCode === "GN" ? String(order.currency ?? "").trim().toUpperCase() || "GNF" : order.currency;

  if (paymentMethod === "orange_money") {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("seller_orders")
      .update({
        status: "pending_checkout",
        payment_status: "unpaid",
        currency,
        checkout_shadow: checkoutShadow,
        paid_at: null,
        updated_at: nowIso,
      })
      .eq("id", order.id)
      .eq("client_user_id", clientUserId)
      .in("status", ["draft", "pending_checkout"])
      .select("*")
      .maybeSingle();

    if (updateError) throw mapUpdateError(updateError.message);
    if (!updated) throw new Error("Order is not eligible for local checkout");

    return {
      ok: true,
      order: { ...order, ...(updated as MarketplaceOrderRow), items: order.items },
      charge_path: "orange_money",
      next: "payments_initiate",
    };
  }

  // cash — hold stock so a confirmed cash order cannot oversell.
  const stockReserve = await reserveMarketplaceStockForCheckout(supabaseAdmin, order.id);
  if (!stockReserve.ok) {
    throw new Error(
      stockReserve.error?.includes("insufficient_stock")
        ? "Insufficient stock for one or more products"
        : stockReserve.error ?? "stock_reserve_failed"
    );
  }

  const { data: updated, error: updateError } = await supabaseAdmin
    .from("seller_orders")
    .update({
      status: "confirmed",
      payment_status: "pending_cash",
      currency,
      checkout_shadow: checkoutShadow,
      paid_at: null,
      updated_at: nowIso,
    })
    .eq("id", order.id)
    .eq("client_user_id", clientUserId)
    .in("status", ["draft", "pending_checkout"])
    .select("*")
    .maybeSingle();

  if (updateError || !updated) {
    await releaseMarketplaceStockReservation(supabaseAdmin, order.id);
    if (updateError) throw mapUpdateError(updateError.message);
    throw new Error("Order is not eligible for local checkout");
  }

  // Fail-open seller notification; no delivery job until the seller accepts.
  try {
    if (seller.user_id) {
      await notifyMarketplaceSellerNewPaidOrder({
        supabaseAdmin,
        sellerUserId: seller.user_id,
        orderId: order.id,
      });
    }
  } catch (notifyError) {
    console.warn("[marketplace-local-checkout] seller notify fail-open", notifyError);
  }

  return {
    ok: true,
    order: { ...order, ...(updated as MarketplaceOrderRow), items: order.items },
    charge_path: "cash",
  };
}
