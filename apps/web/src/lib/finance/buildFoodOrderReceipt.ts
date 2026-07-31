import type { SupabaseClient } from "@supabase/supabase-js";
import { buildEntityFinancialTimeline } from "@/lib/finance/buildEntityFinancialTimeline";
import type { FinancialActorRole } from "@/lib/finance/financialTimelineTypes";
import {
  buildPickupDropoffMapStaticUrl,
  moneyFieldToCents,
  pushFareLine,
  receiptCompanyBlock,
  receiptInvoiceNumber,
  receiptSiteBaseUrl,
  type ReceiptFareLine,
} from "@/lib/finance/receiptCompany";

export type FoodOrderReceiptPayload = {
  company: ReturnType<typeof receiptCompanyBlock>;
  invoice: {
    invoice_number: string;
    entity_number: string;
    entity_id: string;
    issued_at: string;
    status: string;
    payment_status: string;
    refund_status: string | null;
    qr_url: string;
    currency: string;
  };
  delivery: {
    pickup_address: string;
    dropoff_address: string;
    pickup_at: string | null;
    dropoff_at: string | null;
    distance_miles: number | null;
    duration_minutes: number | null;
    eta_minutes: number | null;
    map_static_url: string | null;
  };
  merchant: {
    kind: "restaurant";
    name: string;
    photo_url: string | null;
  } | null;
  driver: {
    name: string | null;
    photo_url: string | null;
    vehicle_label: string | null;
    plate: string | null;
    rating: number | null;
  } | null;
  fare_lines: ReceiptFareLine[];
  totals: {
    subtotal_cents: number;
    tax_cents: number;
    discounts_cents: number;
    tip_cents: number;
    service_fee_cents: number;
    delivery_fee_cents: number;
    total_paid_cents: number;
  };
  payment: {
    method: string;
    funding: string | null;
    brand: string | null;
    last4: string | null;
    payment_intent_id: string | null;
    status: string;
  };
  financial_timeline: Awaited<ReturnType<typeof buildEntityFinancialTimeline>>;
  actions: {
    can_tip: boolean;
    can_rate: boolean;
    can_rebook: boolean;
    can_report: boolean;
  };
};

function isUuid(value: string): boolean {
  return /^[0-9a-f-]{36}$/i.test(value);
}

function buildFoodFareLines(order: Record<string, unknown>): {
  lines: ReceiptFareLine[];
  subtotal_cents: number;
  tax_cents: number;
  discounts_cents: number;
  tip_cents: number;
  service_fee_cents: number;
  delivery_fee_cents: number;
  total_paid_cents: number;
} {
  const subtotal_cents = moneyFieldToCents(
    order.subtotal_cents,
    order.items_subtotal ?? order.subtotal
  );
  const tax_cents = moneyFieldToCents(
    order.tax_cents ?? order.taxes_cents,
    order.tax ?? order.tax_amount
  );
  const service_fee_cents = moneyFieldToCents(
    order.service_fee_cents,
    order.service_fee
  );
  const delivery_fee_cents = moneyFieldToCents(
    order.delivery_fee_cents,
    order.delivery_fee
  );
  const promo_cents = moneyFieldToCents(
    null,
    order.promo_discount_amount ?? order.discounts
  );
  const credit_cents = moneyFieldToCents(order.mmd_credit_applied_cents, null);
  const tip_cents = moneyFieldToCents(order.tip_cents, order.tip);
  const discounts_cents = promo_cents + credit_cents;

  const lines: ReceiptFareLine[] = [];
  pushFareLine(lines, "subtotal", "order.receipt.fare.subtotal", subtotal_cents);
  pushFareLine(lines, "tax", "order.receipt.fare.tax", tax_cents);
  pushFareLine(
    lines,
    "service_fee",
    "order.receipt.fare.serviceFee",
    service_fee_cents
  );
  pushFareLine(
    lines,
    "delivery_fee",
    "order.receipt.fare.deliveryFee",
    delivery_fee_cents
  );
  pushFareLine(lines, "promo", "order.receipt.fare.promo", promo_cents, "discount");
  pushFareLine(
    lines,
    "wallet_credit",
    "order.receipt.fare.walletCredit",
    credit_cents,
    "discount"
  );
  pushFareLine(lines, "tip", "order.receipt.fare.tip", tip_cents);

  let total_paid_cents = moneyFieldToCents(
    order.net_charge_cents ?? order.total_cents,
    order.grand_total ?? order.total
  );
  if (total_paid_cents <= 0) {
    total_paid_cents = Math.max(
      0,
      subtotal_cents +
        tax_cents +
        service_fee_cents +
        delivery_fee_cents -
        discounts_cents +
        tip_cents
    );
  } else if (tip_cents > 0 && total_paid_cents === moneyFieldToCents(order.total_cents, order.total)) {
    // Tip is often stored separately from order total.
    total_paid_cents += tip_cents;
  }

  return {
    lines,
    subtotal_cents,
    tax_cents,
    discounts_cents,
    tip_cents,
    service_fee_cents,
    delivery_fee_cents,
    total_paid_cents,
  };
}

async function loadDriverBlock(
  supabaseAdmin: SupabaseClient,
  driverId: string | null
): Promise<FoodOrderReceiptPayload["driver"]> {
  if (!driverId || !isUuid(driverId)) return null;
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, full_name, avatar_url")
    .eq("id", driverId)
    .maybeSingle();
  if (!profile) {
    return {
      name: null,
      photo_url: null,
      vehicle_label: null,
      plate: null,
      rating: null,
    };
  }
  return {
    name: (profile.full_name as string | null) ?? null,
    photo_url: (profile.avatar_url as string | null) ?? null,
    vehicle_label: null,
    plate: null,
    rating: null,
  };
}

export async function buildFoodOrderReceiptPayload(
  supabaseAdmin: SupabaseClient,
  params: {
    orderId: string;
    role: FinancialActorRole;
    viewerUserId: string;
  }
): Promise<FoodOrderReceiptPayload | { error: string; status: number }> {
  const orderId = String(params.orderId ?? "").trim();
  if (!isUuid(orderId)) {
    return { error: "Invalid order id", status: 400 };
  }

  const { data: access, error: accessError } = await supabaseAdmin
    .from("orders")
    .select("id, client_user_id, created_by, user_id, client_id, driver_id")
    .eq("id", orderId)
    .maybeSingle();

  if (accessError) return { error: accessError.message, status: 500 };
  if (!access) return { error: "Order not found", status: 404 };

  const viewer = params.viewerUserId;
  const isClient =
    String(access.client_user_id ?? "") === viewer ||
    String(access.created_by ?? "") === viewer ||
    String(access.user_id ?? "") === viewer ||
    String(access.client_id ?? "") === viewer;
  const isDriver = String(access.driver_id ?? "") === viewer;
  if (params.role !== "admin" && !isClient && !isDriver) {
    return { error: "Forbidden", status: 403 };
  }

  const { data: orderRow, error } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (error) return { error: error.message, status: 500 };
  if (!orderRow) return { error: "Order not found", status: 404 };

  const order = orderRow as Record<string, unknown>;
  const status = String(order.status ?? "");
  const paymentStatus = String(order.payment_status ?? "");
  const paidAt = order.paid_at ? String(order.paid_at) : null;
  const issuedAt = String(
    order.delivered_confirmed_at ??
      order.completed_at ??
      order.paid_at ??
      order.updated_at ??
      order.created_at
  );

  let restaurantName = String(order.restaurant_name ?? "").trim();
  let restaurantPhoto: string | null = null;
  const restaurantUserId = String(
    order.restaurant_user_id ?? order.restaurant_id ?? ""
  ).trim();
  if (restaurantUserId && isUuid(restaurantUserId)) {
    const { data: restaurant } = await supabaseAdmin
      .from("restaurant_profiles")
      .select("restaurant_name, logo_url, avatar_url")
      .eq("user_id", restaurantUserId)
      .maybeSingle();
    if (restaurant) {
      restaurantName =
        String(restaurant.restaurant_name ?? restaurantName).trim() ||
        restaurantName;
      restaurantPhoto =
        (restaurant.logo_url as string | null) ??
        (restaurant.avatar_url as string | null) ??
        null;
    }
  }

  const fare = buildFoodFareLines(order);
  const driverId = order.driver_id ? String(order.driver_id) : null;
  const driver = await loadDriverBlock(supabaseAdmin, driverId);

  const timelineRole: FinancialActorRole =
    params.role === "admin" ? "admin" : isDriver ? "driver" : "client";

  let financial_timeline: FoodOrderReceiptPayload["financial_timeline"] = [];
  try {
    financial_timeline = await buildEntityFinancialTimeline(supabaseAdmin, {
      entityType: "order",
      entityId: orderId,
      role: timelineRole,
      limit: 40,
    });
  } catch {
    financial_timeline = [];
  }

  return {
    company: receiptCompanyBlock(),
    invoice: {
      invoice_number: receiptInvoiceNumber("FD", orderId, paidAt),
      entity_number: orderId.slice(0, 8).toUpperCase(),
      entity_id: orderId,
      issued_at: issuedAt,
      status,
      payment_status: paymentStatus,
      refund_status: order.refund_status ? String(order.refund_status) : null,
      qr_url: `${receiptSiteBaseUrl()}/food/receipt/${orderId}`,
      currency: String(order.currency ?? "USD").toUpperCase(),
    },
    delivery: {
      pickup_address: String(order.pickup_address ?? ""),
      dropoff_address: String(order.dropoff_address ?? ""),
      pickup_at: order.picked_up_at ? String(order.picked_up_at) : null,
      dropoff_at: order.delivered_confirmed_at
        ? String(order.delivered_confirmed_at)
        : order.completed_at
          ? String(order.completed_at)
          : null,
      distance_miles: Number.isFinite(Number(order.distance_miles))
        ? Number(order.distance_miles)
        : null,
      duration_minutes: Number.isFinite(Number(order.duration_minutes))
        ? Number(order.duration_minutes)
        : null,
      eta_minutes: Number.isFinite(Number(order.eta_minutes))
        ? Number(order.eta_minutes)
        : null,
      map_static_url: buildPickupDropoffMapStaticUrl(order),
    },
    merchant: restaurantName
      ? {
          kind: "restaurant",
          name: restaurantName,
          photo_url: restaurantPhoto,
        }
      : null,
    driver,
    fare_lines: fare.lines,
    totals: {
      subtotal_cents: fare.subtotal_cents,
      tax_cents: fare.tax_cents,
      discounts_cents: fare.discounts_cents,
      tip_cents: fare.tip_cents,
      service_fee_cents: fare.service_fee_cents,
      delivery_fee_cents: fare.delivery_fee_cents,
      total_paid_cents: fare.total_paid_cents,
    },
    payment: {
      method:
        String(order.payment_funding ?? "") === "business_wallet"
          ? "business_wallet"
          : "card",
      funding: order.payment_funding ? String(order.payment_funding) : null,
      brand: order.payment_card_brand ? String(order.payment_card_brand) : null,
      last4: order.payment_card_last4 ? String(order.payment_card_last4) : null,
      payment_intent_id: order.stripe_payment_intent_id
        ? String(order.stripe_payment_intent_id)
        : null,
      status: paymentStatus,
    },
    financial_timeline,
    actions: {
      can_tip:
        isClient &&
        status === "delivered" &&
        fare.tip_cents <= 0 &&
        paymentStatus === "paid",
      can_rate: isClient && status === "delivered",
      can_rebook: isClient,
      can_report: isClient || isDriver,
    },
  };
}
