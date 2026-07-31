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

export type DeliveryRequestReceiptPayload = {
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
    kind: "package";
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

function buildPackageFareLines(row: Record<string, unknown>): {
  lines: ReceiptFareLine[];
  subtotal_cents: number;
  tax_cents: number;
  discounts_cents: number;
  tip_cents: number;
  service_fee_cents: number;
  delivery_fee_cents: number;
  total_paid_cents: number;
} {
  const subtotal_cents = moneyFieldToCents(null, row.subtotal);
  const tax_cents = moneyFieldToCents(row.tax_cents, row.tax);
  const service_fee_cents = moneyFieldToCents(
    row.service_fee_cents,
    row.service_fee
  );
  const delivery_fee_cents = moneyFieldToCents(
    row.delivery_fee_cents,
    row.delivery_fee
  );
  const credit_cents = moneyFieldToCents(row.mmd_credit_applied_cents, null);
  const tip_cents = moneyFieldToCents(row.tip_cents, row.tip);
  const discounts_cents = credit_cents;

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
  pushFareLine(
    lines,
    "wallet_credit",
    "order.receipt.fare.walletCredit",
    credit_cents,
    "discount"
  );
  pushFareLine(lines, "tip", "order.receipt.fare.tip", tip_cents);

  let total_paid_cents = moneyFieldToCents(
    row.net_charge_cents ?? row.total_cents,
    row.total
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
  } else if (tip_cents > 0) {
    const baseTotal = moneyFieldToCents(row.total_cents, row.total);
    if (total_paid_cents === baseTotal) total_paid_cents += tip_cents;
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
): Promise<DeliveryRequestReceiptPayload["driver"]> {
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

export async function buildDeliveryRequestReceiptPayload(
  supabaseAdmin: SupabaseClient,
  params: {
    deliveryRequestId: string;
    role: FinancialActorRole;
    viewerUserId: string;
  }
): Promise<DeliveryRequestReceiptPayload | { error: string; status: number }> {
  const deliveryRequestId = String(params.deliveryRequestId ?? "").trim();
  if (!isUuid(deliveryRequestId)) {
    return { error: "Invalid delivery request id", status: 400 };
  }

  const { data: access, error: accessError } = await supabaseAdmin
    .from("delivery_requests")
    .select("id, client_user_id, created_by, driver_id")
    .eq("id", deliveryRequestId)
    .maybeSingle();

  if (accessError) return { error: accessError.message, status: 500 };
  if (!access) return { error: "Delivery request not found", status: 404 };

  const viewer = params.viewerUserId;
  const isClient =
    String(access.client_user_id ?? "") === viewer ||
    String(access.created_by ?? "") === viewer;
  const isDriver = String(access.driver_id ?? "") === viewer;
  if (params.role !== "admin" && !isClient && !isDriver) {
    return { error: "Forbidden", status: 403 };
  }

  const { data: row, error } = await supabaseAdmin
    .from("delivery_requests")
    .select("*")
    .eq("id", deliveryRequestId)
    .maybeSingle();

  if (error) return { error: error.message, status: 500 };
  if (!row) return { error: "Delivery request not found", status: 404 };

  const request = row as Record<string, unknown>;
  const status = String(request.status ?? "");
  const paymentStatus = String(request.payment_status ?? "");
  const paidAt = request.paid_at ? String(request.paid_at) : null;
  const issuedAt = String(
    request.delivered_confirmed_at ??
      request.completed_at ??
      request.paid_at ??
      request.updated_at ??
      request.created_at
  );

  const packageTitle =
    String(request.title ?? "").trim() ||
    `Package ${deliveryRequestId.slice(0, 8).toUpperCase()}`;

  const fare = buildPackageFareLines(request);
  const driverId = request.driver_id ? String(request.driver_id) : null;
  const driver = await loadDriverBlock(supabaseAdmin, driverId);

  const timelineRole: FinancialActorRole =
    params.role === "admin" ? "admin" : isDriver ? "driver" : "client";

  let financial_timeline: DeliveryRequestReceiptPayload["financial_timeline"] =
    [];
  try {
    financial_timeline = await buildEntityFinancialTimeline(supabaseAdmin, {
      entityType: "delivery_request",
      entityId: deliveryRequestId,
      role: timelineRole,
      limit: 40,
    });
  } catch {
    financial_timeline = [];
  }

  const completedLike =
    status === "delivered" ||
    status === "completed" ||
    Boolean(request.delivered_confirmed_at);

  return {
    company: receiptCompanyBlock(),
    invoice: {
      invoice_number: receiptInvoiceNumber("PK", deliveryRequestId, paidAt),
      entity_number: deliveryRequestId.slice(0, 8).toUpperCase(),
      entity_id: deliveryRequestId,
      issued_at: issuedAt,
      status,
      payment_status: paymentStatus,
      refund_status: request.refund_status
        ? String(request.refund_status)
        : null,
      qr_url: `${receiptSiteBaseUrl()}/delivery/receipt/${deliveryRequestId}`,
      currency: String(request.currency ?? "USD").toUpperCase(),
    },
    delivery: {
      pickup_address: String(request.pickup_address ?? ""),
      dropoff_address: String(request.dropoff_address ?? ""),
      pickup_at: request.picked_up_at ? String(request.picked_up_at) : null,
      dropoff_at: request.delivered_confirmed_at
        ? String(request.delivered_confirmed_at)
        : request.completed_at
          ? String(request.completed_at)
          : null,
      distance_miles: Number.isFinite(Number(request.distance_miles))
        ? Number(request.distance_miles)
        : null,
      duration_minutes: Number.isFinite(Number(request.duration_minutes))
        ? Number(request.duration_minutes)
        : null,
      eta_minutes: Number.isFinite(Number(request.eta_minutes))
        ? Number(request.eta_minutes)
        : null,
      map_static_url: buildPickupDropoffMapStaticUrl(request),
    },
    merchant: {
      kind: "package",
      name: packageTitle,
      photo_url: null,
    },
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
        String(request.payment_funding ?? "") === "business_wallet"
          ? "business_wallet"
          : "card",
      funding: request.payment_funding
        ? String(request.payment_funding)
        : null,
      brand: request.payment_card_brand
        ? String(request.payment_card_brand)
        : null,
      last4: request.payment_card_last4
        ? String(request.payment_card_last4)
        : null,
      payment_intent_id: request.stripe_payment_intent_id
        ? String(request.stripe_payment_intent_id)
        : null,
      status: paymentStatus,
    },
    financial_timeline,
    actions: {
      can_tip:
        isClient &&
        completedLike &&
        fare.tip_cents <= 0 &&
        paymentStatus === "paid",
      can_rate: isClient && completedLike,
      can_rebook: isClient,
      can_report: isClient || isDriver,
    },
  };
}
