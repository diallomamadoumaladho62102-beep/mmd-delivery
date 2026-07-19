// apps/web/app/api/stripe/webhook/route.ts
// Canonical Stripe webhook (Live): https://www.mmddelivery.com/api/stripe/webhook
// Disable Supabase Edge stripe_webhook in production (MMD_STRIPE_WEBHOOK_DISABLED=true).
// Idempotency: public.stripe_webhook_events.stripe_event_id (unique).
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  createClient,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { stripe, webhookSecret } from "@/lib/stripe";
import { handleSubscriptionStripeEvent } from "@/lib/subscriptions/stripeSubscriptionWebhook";
import { handleMmdPlusStripeEvent } from "@/lib/mmdPlus/stripeMmdPlusWebhook";
import {
  ensureOrderCommissionsReady,
  refreshCommissionsForDeliveryRequest,
} from "@/lib/refreshOrderCommissions";
import {
  getDispatchSiteOrigin,
  scheduleDeliveryRequestDispatch,
} from "@/lib/scheduleDeliveryRequestDispatch";
import { stripeEventNeedsReprocessing } from "@/lib/stripeWebhookReprocess";
import {
  syncStripeChargeRefunded,
  syncStripeRefundObject,
} from "@/lib/stripeWebhookChargeRefunded";
import {
  handleCheckoutSessionExpiredEvent,
  handlePaymentIntentFailedEvent,
} from "@/lib/stripeWebhookPaymentFailure";
import { recordProductionCriticalError } from "@/lib/productionMonitoring";
import {
  getStripeAmountFromCheckoutSession as getTaxiCheckoutAmountCents,
  handleTaxiStripePayment,
  isTaxiStripeModule,
  pickTaxiRideIdFromMetadata,
} from "@/lib/taxiStripeWebhook";
import {
  getMarketplaceStripeAmountFromCheckoutSession,
  getMarketplaceStripeAmountFromPaymentIntent,
  handleMarketplaceStripePayment,
  isMarketplaceCheckoutSessionPaid,
  isMarketplaceStripeModule,
  pickSellerOrderIdFromMetadata,
} from "@/lib/marketplaceStripeWebhook";
import {
  bridgeStripeWalletFromPaidDeliveryRequest,
  bridgeStripeWalletFromPaidOrder,
} from "@/lib/stripeInboundWalletBridge";
import {
  ORDER_PAYMENT_CHECK_SELECT,
  ORDER_POST_PAID_SELECT,
} from "@/lib/orderPaymentSelect";
import { resolveOrderPlatformCountry } from "@/lib/platformCountryResolver";
import {
  assertSettlementMatchesExpectation,
  isPaymentSettlementFailure,
  requirePaymentIntentSucceeded,
  type PaymentExpectation,
  type PaymentExpectationResult,
} from "@/lib/requirePaymentIntentSucceeded";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Defense-in-depth for the shared webhook: the event is Stripe-signed, but the
// handler routes purely by metadata. Before marking any resource paid we
// re-assert that the (signed) metadata's user / service_type / entity id match
// the resource actually loaded from the DB — finding `order_id` in metadata is
// not enough. Versioned PIs (metadata_schema_version) are strictly validated;
// historical PIs keep the tolerant "verify-if-present" behaviour. Amount and
// currency are already checked against the row before this runs, so they are
// not re-passed here. Returns a secret-free, replay-safe result.
function assertWebhookEntityMetadata(
  metadata: Record<string, unknown> | null,
  refs: {
    paymentIntentId: string | null;
    sessionId: string | null;
    amountCents: number | null;
    currency: string | null;
  },
  expectation: PaymentExpectation
): PaymentExpectationResult {
  return assertSettlementMatchesExpectation(
    {
      ok: true,
      payment_intent_id: refs.paymentIntentId,
      amount_cents: refs.amountCents ?? 0,
      currency: String(refs.currency ?? "usd").toLowerCase(),
      session_id: refs.sessionId,
      metadata,
    },
    metadata,
    expectation
  );
}

type OrderRow = {
  id: string;
  payment_status: string | null;
  total: number | null;
  grand_total: number | null;
  total_cents: number | null;
  net_charge_cents?: number | null;
  currency: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  client_user_id?: string | null;
  created_by?: string | null;
  user_id?: string | null;
  kind?: string | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
};

type DeliveryRequestRow = {
  id: string;
  payment_status: string | null;
  total: number | null;
  total_cents: number | null;
  net_charge_cents?: number | null;
  currency: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  client_user_id?: string | null;
  created_by?: string | null;
  country_code?: string | null;
};

type MinimalOrderForAmount = Pick<
  OrderRow,
  "total" | "grand_total" | "total_cents" | "net_charge_cents" | "currency"
>;

type MinimalDeliveryRequestForAmount = Pick<
  DeliveryRequestRow,
  "total" | "total_cents" | "net_charge_cents" | "currency"
>;

type OrderLookupResult = {
  order: OrderRow | null;
  error: PostgrestError | null;
};

type DeliveryRequestLookupResult = {
  deliveryRequest: DeliveryRequestRow | null;
  error: PostgrestError | null;
};

type VerifyPaidStateSuccess = {
  ok: true;
  reason: "verified";
  error: null;
  order: OrderRow;
};

type VerifyPaidStateFailure = {
  ok: false;
  reason:
    | "verify_lookup_failed"
    | "verify_order_not_found"
    | "verify_not_paid"
    | "verify_session_mismatch"
    | "verify_payment_intent_mismatch";
  error: PostgrestError | null;
  order: OrderRow | null;
};

type VerifyPaidStateResult = VerifyPaidStateSuccess | VerifyPaidStateFailure;

type VerifyDeliveryPaidStateSuccess = {
  ok: true;
  reason: "verified";
  error: null;
  deliveryRequest: DeliveryRequestRow;
};

type VerifyDeliveryPaidStateFailure = {
  ok: false;
  reason:
    | "verify_lookup_failed"
    | "verify_delivery_request_not_found"
    | "verify_not_paid"
    | "verify_session_mismatch"
    | "verify_payment_intent_mismatch";
  error: PostgrestError | null;
  deliveryRequest: DeliveryRequestRow | null;
};

type VerifyDeliveryPaidStateResult =
  | VerifyDeliveryPaidStateSuccess
  | VerifyDeliveryPaidStateFailure;

type FallbackSuccess = {
  ok: true;
  used: string;
  alreadyPaid?: boolean;
};

type FallbackFailure = {
  ok: false;
  error: unknown;
};

type FallbackResult = FallbackSuccess | FallbackFailure;

type RobustMarkPaidSuccess = {
  ok: true;
  via: "rpc" | "fallback_update";
  rpcData?: unknown;
  used?: string;
  already_paid?: boolean;
};

type RobustMarkPaidFailure = {
  ok: false;
  rpc: {
    data: unknown;
    error: unknown;
  };
  fallback: FallbackFailure;
};

type RobustMarkPaidResult = RobustMarkPaidSuccess | RobustMarkPaidFailure;

type DeliveryFallbackSuccess = {
  ok: true;
  used: string;
  alreadyPaid?: boolean;
};

type DeliveryFallbackFailure = {
  ok: false;
  error: unknown;
};

type DeliveryFallbackResult = DeliveryFallbackSuccess | DeliveryFallbackFailure;

type DeliveryRobustMarkPaidSuccess = {
  ok: true;
  via: "fallback_update";
  used?: string;
  already_paid?: boolean;
};

type DeliveryRobustMarkPaidFailure = {
  ok: false;
  fallback: DeliveryFallbackFailure;
};

type DeliveryRobustMarkPaidResult =
  | DeliveryRobustMarkPaidSuccess
  | DeliveryRobustMarkPaidFailure;

type GenericErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

type StripeFeeSnapshot = {
  stripe_fee_cents: number;
  stripe_net_cents: number | null;
  stripe_balance_transaction_id: string | null;
  stripe_charge_id: string | null;
};

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024; // 1 MB
const HANDLED_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "payment_intent.succeeded",
  "checkout.session.expired",
  "payment_intent.payment_failed",
  "charge.refunded",
  "refund.updated",
  // Phase 5 — Stripe Billing subscriptions
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
]);

function asErrorLike(value: unknown): GenericErrorLike | null {
  if (!value || typeof value !== "object") return null;
  return value as GenericErrorLike;
}

function getErrorMessage(value: unknown): string {
  if (value instanceof Error && value.message) return value.message;

  const errorLike = asErrorLike(value);
  if (typeof errorLike?.message === "string" && errorLike.message.trim()) {
    return errorLike.message;
  }

  return "Unknown error";
}

function getErrorCode(value: unknown): string | null {
  const errorLike = asErrorLike(value);
  return typeof errorLike?.code === "string" ? errorLike.code : null;
}

function getErrorDetails(value: unknown): string | null {
  const errorLike = asErrorLike(value);
  return typeof errorLike?.details === "string" ? errorLike.details : null;
}

function getErrorHint(value: unknown): string | null {
  const errorLike = asErrorLike(value);
  return typeof errorLike?.hint === "string" ? errorLike.hint : null;
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function methodNotAllowed() {
  return NextResponse.json(
    { error: "Method not allowed" },
    {
      status: 405,
      headers: {
        Allow: "POST",
        "Cache-Control": "no-store",
        Pragma: "no-cache",
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}

async function getRawBody(req: NextRequest): Promise<Buffer> {
  const contentLengthHeader = req.headers.get("content-length");
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : 0;

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_WEBHOOK_BODY_BYTES
  ) {
    throw new Error("Webhook body too large");
  }

  const ab = await req.arrayBuffer();

  if (ab.byteLength > MAX_WEBHOOK_BODY_BYTES) {
    throw new Error("Webhook body too large");
  }

  return Buffer.from(ab);
}

function getSupabaseAdmin(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Missing env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)"
    );
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

function isPaidStatus(status: unknown): boolean {
  return String(status ?? "").trim().toLowerCase() === "paid";
}

function pickOrderIdFromMetadata(
  md: Record<string, unknown> | null | undefined
): string | null {
  const raw =
    md?.orderId ??
    md?.order_id ??
    md?.orderID ??
    md?.order ??
    md?.order_uuid ??
    null;

  if (!raw) return null;

  const normalized = String(raw).trim();
  return normalized.length > 0 ? normalized : null;
}

function pickDeliveryRequestIdFromMetadata(
  md: Record<string, unknown> | null | undefined
): string | null {
  const raw =
    md?.deliveryRequestId ??
    md?.delivery_request_id ??
    md?.delivery_requestId ??
    md?.deliveryRequestID ??
    md?.delivery_request ??
    md?.delivery ??
    md?.requestId ??
    md?.request_id ??
    md?.delivery_request_uuid ??
    null;

  if (!raw) return null;

  const normalized = String(raw).trim();
  return normalized.length > 0 ? normalized : null;
}

function toPositiveNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function resolveOrderAmountCents(order: MinimalOrderForAmount): number | null {
  // Crédit MMD: when a net charge was frozen at checkout, the customer was
  // charged the net — verify against it (never above the gross).
  const netCharge = toPositiveNumber(order.net_charge_cents);
  const grossForNet = toPositiveNumber(order.total_cents);
  if (netCharge != null && (grossForNet == null || netCharge <= grossForNet)) {
    return Math.round(netCharge);
  }

  const totalCents = toPositiveNumber(order.total_cents);
  if (totalCents != null) return Math.round(totalCents);

  const total = toPositiveNumber(order.total);
  if (total != null) return Math.round(total * 100);

  const grandTotal = toPositiveNumber(order.grand_total);
  if (grandTotal != null) return Math.round(grandTotal * 100);

  return null;
}

function resolveDeliveryRequestAmountCents(
  deliveryRequest: MinimalDeliveryRequestForAmount
): number | null {
  const netCharge = toPositiveNumber(deliveryRequest.net_charge_cents);
  const grossForNet = toPositiveNumber(deliveryRequest.total_cents);
  if (netCharge != null && (grossForNet == null || netCharge <= grossForNet)) {
    return Math.round(netCharge);
  }

  const totalCents = toPositiveNumber(deliveryRequest.total_cents);
  if (totalCents != null) return Math.round(totalCents);

  const total = toPositiveNumber(deliveryRequest.total);
  if (total != null) return Math.round(total * 100);

  return null;
}

function normalizeCurrency(value: unknown): string | null {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw ? raw : null;
}

async function requireOrderWalletBridge(params: {
  supabaseAdmin: SupabaseClient;
  paymentIntentId: string | null;
  order: OrderRow;
  source: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!params.paymentIntentId) return { ok: true };

  const bridge = await bridgeStripeWalletFromPaidOrder(params.supabaseAdmin, {
    paymentIntentId: params.paymentIntentId,
    order: params.order,
    source: params.source,
  });

  if (bridge.ok === false) {
    return { ok: false, error: bridge.error };
  }

  return { ok: true };
}

async function requireDeliveryRequestWalletBridge(params: {
  supabaseAdmin: SupabaseClient;
  paymentIntentId: string | null;
  deliveryRequest: DeliveryRequestRow;
  source: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!params.paymentIntentId) return { ok: true };

  const bridge = await bridgeStripeWalletFromPaidDeliveryRequest(
    params.supabaseAdmin,
    {
      paymentIntentId: params.paymentIntentId,
      deliveryRequest: params.deliveryRequest,
      source: params.source,
    },
  );

  if (bridge.ok === false) {
    return { ok: false, error: bridge.error };
  }

  return { ok: true };
}

function walletBridgeFailureResponse(
  context: Record<string, unknown>,
  error: string,
) {
  console.error("[webhook] wallet bridge failed", { ...context, error });
  recordProductionCriticalError("stripe_webhook_wallet_bridge", error, context);
  return json(
    {
      received: true,
      ok: false,
      error: "wallet_ledger_bridge_failed",
      details: error,
      ...context,
    },
    500,
  );
}

async function loadOrderForPaymentCheck(
  supabaseAdmin: SupabaseClient,
  orderId: string
): Promise<OrderLookupResult> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(ORDER_PAYMENT_CHECK_SELECT)
    .eq("id", orderId)
    .maybeSingle<OrderRow>();

  return {
    order: data ?? null,
    error,
  };
}

async function loadDeliveryRequestForPaymentCheck(
  supabaseAdmin: SupabaseClient,
  deliveryRequestId: string
): Promise<DeliveryRequestLookupResult> {
  const { data, error } = await supabaseAdmin
    .from("delivery_requests")
    .select(
      "id, payment_status, total, total_cents, net_charge_cents, currency, stripe_session_id, stripe_payment_intent_id, client_user_id, created_by, country_code"
    )
    .eq("id", deliveryRequestId)
    .maybeSingle<DeliveryRequestRow>();

  return {
    deliveryRequest: data ?? null,
    error,
  };
}

function getStripeAmountTotalFromSession(
  session: Stripe.Checkout.Session
): number | null {
  const n = Number(session.amount_total ?? 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function getStripeAmountFromPaymentIntent(
  pi: Stripe.PaymentIntent
): number | null {
  const n = Number(pi.amount ?? 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}


async function getStripeFeeSnapshot(
  paymentIntentId: string
): Promise<StripeFeeSnapshot> {
  try {
    const expandedPi = await stripe.paymentIntents.retrieve(paymentIntentId, {
      expand: ["latest_charge.balance_transaction"],
    });

    const latestCharge =
      expandedPi.latest_charge && typeof expandedPi.latest_charge === "object"
        ? (expandedPi.latest_charge as Stripe.Charge)
        : null;

    const balanceTransaction =
      latestCharge?.balance_transaction &&
      typeof latestCharge.balance_transaction === "object"
        ? (latestCharge.balance_transaction as Stripe.BalanceTransaction)
        : null;

    return {
      stripe_fee_cents:
        typeof balanceTransaction?.fee === "number"
          ? balanceTransaction.fee
          : 0,
      stripe_net_cents:
        typeof balanceTransaction?.net === "number"
          ? balanceTransaction.net
          : null,
      stripe_balance_transaction_id:
        typeof balanceTransaction?.id === "string"
          ? balanceTransaction.id
          : null,
      stripe_charge_id:
        typeof latestCharge?.id === "string" ? latestCharge.id : null,
    };
  } catch (error) {
    console.log("⚠️ WEBHOOK: could not retrieve Stripe fee snapshot", {
      paymentIntentId,
      message: getErrorMessage(error),
    });

    return {
      stripe_fee_cents: 0,
      stripe_net_cents: null,
      stripe_balance_transaction_id: null,
      stripe_charge_id: null,
    };
  }
}

async function persistStripeFeeSnapshot(opts: {
  supabaseAdmin: SupabaseClient;
  paymentIntentId: string;
  snapshot: StripeFeeSnapshot;
  orderId?: string | null;
  deliveryRequestId?: string | null;
}) {
  const {
    supabaseAdmin,
    paymentIntentId,
    snapshot,
    orderId = null,
    deliveryRequestId = null,
  } = opts;

  const paymentsPayload = {
    stripe_fee_cents: snapshot.stripe_fee_cents,
    stripe_net_cents: snapshot.stripe_net_cents,
    stripe_balance_transaction_id: snapshot.stripe_balance_transaction_id,
    stripe_charge_id: snapshot.stripe_charge_id,
    updated_at: new Date().toISOString(),
  };

  const { error: paymentsError } = await supabaseAdmin
    .from("payments")
    .update(paymentsPayload)
    .eq("provider_payment_intent_id", paymentIntentId);

  if (paymentsError) {
    console.log("⚠️ WEBHOOK: payments Stripe fee update failed", {
      paymentIntentId,
      code: getErrorCode(paymentsError),
      message: getErrorMessage(paymentsError),
      details: getErrorDetails(paymentsError),
      hint: getErrorHint(paymentsError),
    });
  }

  const ordersPayload = {
    stripe_fee_cents: snapshot.stripe_fee_cents,
    stripe_net_cents: snapshot.stripe_net_cents,
  };

  if (orderId) {
    const { error: orderError } = await supabaseAdmin
      .from("orders")
      .update(ordersPayload)
      .eq("id", orderId);

    if (orderError) {
      console.log("⚠️ WEBHOOK: order Stripe fee update failed", {
        orderId,
        paymentIntentId,
        code: getErrorCode(orderError),
        message: getErrorMessage(orderError),
        details: getErrorDetails(orderError),
        hint: getErrorHint(orderError),
      });
    }
  }

  if (deliveryRequestId) {
    const { error: linkedOrderError } = await supabaseAdmin
      .from("orders")
      .update(ordersPayload)
      .eq("external_ref_id", deliveryRequestId)
      .eq("external_ref_type", "delivery_request");

    if (linkedOrderError) {
      console.log("⚠️ WEBHOOK: linked delivery_request order Stripe fee update failed", {
        deliveryRequestId,
        paymentIntentId,
        code: getErrorCode(linkedOrderError),
        message: getErrorMessage(linkedOrderError),
        details: getErrorDetails(linkedOrderError),
        hint: getErrorHint(linkedOrderError),
      });
    }
  }

  console.log("✅ WEBHOOK: Stripe fee snapshot persisted", {
    paymentIntentId,
    orderId,
    deliveryRequestId,
    stripe_fee_cents: snapshot.stripe_fee_cents,
    stripe_net_cents: snapshot.stripe_net_cents,
    stripe_balance_transaction_id: snapshot.stripe_balance_transaction_id,
    stripe_charge_id: snapshot.stripe_charge_id,
  });
}


function paymentIntentIdFromUnknown(value: unknown): string | null {
  if (isNonEmptyString(value)) return value.trim();

  if (value && typeof value === "object" && "id" in value) {
    const maybeId = (value as { id?: unknown }).id;
    if (isNonEmptyString(maybeId)) return maybeId.trim();
  }

  return null;
}

function normalizeStringOrNull(value: unknown): string | null {
  if (!isNonEmptyString(value)) return null;
  return value.trim();
}

function isCheckoutSessionActuallyPaid(
  session: Stripe.Checkout.Session
): boolean {
  return String(session.payment_status ?? "").toLowerCase() === "paid";
}

function isMatchingOrEmpty(existing: string | null, incoming: string | null) {
  if (!existing || existing.trim() === "") return true;
  if (!incoming || incoming.trim() === "") return true;
  return existing.trim() === incoming.trim();
}

async function verifyOrderPaidState(opts: {
  supabaseAdmin: SupabaseClient;
  orderId: string;
  expectedSessionId?: string | null;
  expectedPaymentIntentId?: string | null;
}): Promise<VerifyPaidStateResult> {
  const { supabaseAdmin, orderId, expectedSessionId, expectedPaymentIntentId } =
    opts;

  const { order, error } = await loadOrderForPaymentCheck(supabaseAdmin, orderId);

  if (error) {
    return {
      ok: false,
      reason: "verify_lookup_failed",
      error,
      order: null,
    };
  }

  if (!order) {
    return {
      ok: false,
      reason: "verify_order_not_found",
      error: null,
      order: null,
    };
  }

  if (!isPaidStatus(order.payment_status)) {
    return {
      ok: false,
      reason: "verify_not_paid",
      error: null,
      order,
    };
  }

  if (
    expectedSessionId &&
    !isMatchingOrEmpty(order.stripe_session_id, expectedSessionId)
  ) {
    return {
      ok: false,
      reason: "verify_session_mismatch",
      error: null,
      order,
    };
  }

  if (
    expectedPaymentIntentId &&
    !isMatchingOrEmpty(order.stripe_payment_intent_id, expectedPaymentIntentId)
  ) {
    return {
      ok: false,
      reason: "verify_payment_intent_mismatch",
      error: null,
      order,
    };
  }

  return {
    ok: true,
    reason: "verified",
    error: null,
    order,
  };
}

async function verifyDeliveryRequestPaidState(opts: {
  supabaseAdmin: SupabaseClient;
  deliveryRequestId: string;
  expectedSessionId?: string | null;
  expectedPaymentIntentId?: string | null;
}): Promise<VerifyDeliveryPaidStateResult> {
  const {
    supabaseAdmin,
    deliveryRequestId,
    expectedSessionId,
    expectedPaymentIntentId,
  } = opts;

  const { deliveryRequest, error } = await loadDeliveryRequestForPaymentCheck(
    supabaseAdmin,
    deliveryRequestId
  );

  if (error) {
    return {
      ok: false,
      reason: "verify_lookup_failed",
      error,
      deliveryRequest: null,
    };
  }

  if (!deliveryRequest) {
    return {
      ok: false,
      reason: "verify_delivery_request_not_found",
      error: null,
      deliveryRequest: null,
    };
  }

  if (!isPaidStatus(deliveryRequest.payment_status)) {
    return {
      ok: false,
      reason: "verify_not_paid",
      error: null,
      deliveryRequest,
    };
  }

  if (
    expectedSessionId &&
    !isMatchingOrEmpty(deliveryRequest.stripe_session_id, expectedSessionId)
  ) {
    return {
      ok: false,
      reason: "verify_session_mismatch",
      error: null,
      deliveryRequest,
    };
  }

  if (
    expectedPaymentIntentId &&
    !isMatchingOrEmpty(
      deliveryRequest.stripe_payment_intent_id,
      expectedPaymentIntentId
    )
  ) {
    return {
      ok: false,
      reason: "verify_payment_intent_mismatch",
      error: null,
      deliveryRequest,
    };
  }

  return {
    ok: true,
    reason: "verified",
    error: null,
    deliveryRequest,
  };
}

function stripeEventLivemode(event: Stripe.Event): boolean {
  const raw = event as Stripe.Event & { livemode?: boolean };
  return Boolean(raw.livemode);
}

async function persistStripeEvent(opts: {
  supabaseAdmin: SupabaseClient;
  event: Stripe.Event;
}): Promise<{ inserted: boolean; duplicate: boolean; failed: boolean }> {
  const { supabaseAdmin, event } = opts;
  const stripeEventId = String(event.id ?? "").trim();
  const eventType = String(event.type ?? "").trim();

  if (!stripeEventId || !eventType) {
    return { inserted: false, duplicate: false, failed: true };
  }

  try {
    const { error } = await supabaseAdmin.from("stripe_webhook_events").insert({
      stripe_event_id: stripeEventId,
      event_type: eventType,
      livemode: stripeEventLivemode(event),
      payload: {
        id: stripeEventId,
        type: eventType,
        created: event.created ?? null,
      },
    });

    if (!error) {
      console.log("✅ WEBHOOK: stripe_webhook_events saved", {
        event_id: stripeEventId,
        type: eventType,
      });
      return { inserted: true, duplicate: false, failed: false };
    }

    const code = getErrorCode(error);
    const message = getErrorMessage(error).toLowerCase();

    const looksDuplicate =
      code === "23505" ||
      message.includes("duplicate key") ||
      message.includes("unique constraint") ||
      message.includes("already exists");

    if (looksDuplicate) {
      console.log("ℹ️ WEBHOOK: duplicate event ignored", {
        event_id: stripeEventId,
        type: eventType,
        code,
        message: getErrorMessage(error),
      });
      return { inserted: false, duplicate: true, failed: false };
    }

    const { data: existing, error: existingError } = await supabaseAdmin
      .from("stripe_webhook_events")
      .select("id")
      .eq("stripe_event_id", stripeEventId)
      .maybeSingle();

    if (!existingError && existing?.id != null) {
      return { inserted: false, duplicate: true, failed: false };
    }

    console.log("⚠️ WEBHOOK: could not insert stripe_webhook_events row", {
      code,
      message: getErrorMessage(error),
      details: getErrorDetails(error),
      hint: getErrorHint(error),
      event_id: stripeEventId,
      type: eventType,
    });

    return { inserted: false, duplicate: false, failed: true };
  } catch (e: unknown) {
    console.log(
      "⚠️ WEBHOOK: stripe_webhook_events insert crashed",
      getErrorMessage(e)
    );
    return { inserted: false, duplicate: false, failed: true };
  }
}

function isFallbackFailure(result: FallbackResult): result is FallbackFailure {
  return result.ok === false;
}

function isRobustMarkPaidFailure(
  result: RobustMarkPaidResult
): result is RobustMarkPaidFailure {
  return result.ok === false;
}

function isDeliveryFallbackFailure(
  result: DeliveryFallbackResult
): result is DeliveryFallbackFailure {
  return result.ok === false;
}

function isDeliveryRobustMarkPaidFailure(
  result: DeliveryRobustMarkPaidResult
): result is DeliveryRobustMarkPaidFailure {
  return result.ok === false;
}

async function fallbackMarkPaid(opts: {
  supabaseAdmin: SupabaseClient;
  orderId: string;
  sessionId: string | null;
  paymentIntentId: string | null;
}): Promise<FallbackResult> {
  const { supabaseAdmin, orderId, sessionId, paymentIntentId } = opts;
  const nowIso = new Date().toISOString();

  const { order, error: readErr } = await loadOrderForPaymentCheck(
    supabaseAdmin,
    orderId
  );

  if (readErr) {
    return { ok: false, error: readErr };
  }

  if (!order) {
    return { ok: false, error: new Error(`Order not found: ${orderId}`) };
  }

  if (isPaidStatus(order.payment_status)) {
    console.log("ℹ️ WEBHOOK fallback skipped: order already paid", { orderId });
    return { ok: true, used: "already_paid", alreadyPaid: true };
  }

  const attempts: Array<{ label: string; payload: Record<string, unknown> }> = [
    {
      label: "payment_status + paid_at + stripe refs + updated_at",
      payload: {
        payment_status: "paid",
        paid_at: nowIso,
        ...(sessionId ? { stripe_session_id: sessionId } : {}),
        ...(paymentIntentId ? { stripe_payment_intent_id: paymentIntentId } : {}),
        updated_at: nowIso,
      },
    },
    {
      label: "payment_status + paid_at + updated_at",
      payload: {
        payment_status: "paid",
        paid_at: nowIso,
        updated_at: nowIso,
      },
    },
  ];

  let lastErr: unknown = null;

  for (const attempt of attempts) {
    const { error } = await supabaseAdmin
      .from("orders")
      .update(attempt.payload)
      .eq("id", orderId)
      .neq("payment_status", "paid");

    if (!error) {
      console.log("✅ WEBHOOK fallback update OK", {
        label: attempt.label,
        orderId,
      });
      return { ok: true, used: attempt.label };
    }

    lastErr = error;
    console.log("⚠️ WEBHOOK fallback update failed", {
      label: attempt.label,
      code: getErrorCode(error),
      message: getErrorMessage(error),
      details: getErrorDetails(error),
      hint: getErrorHint(error),
    });
  }

  return { ok: false, error: lastErr };
}

async function fallbackMarkDeliveryRequestPaid(opts: {
  supabaseAdmin: SupabaseClient;
  deliveryRequestId: string;
  sessionId: string | null;
  paymentIntentId: string | null;
}): Promise<DeliveryFallbackResult> {
  const { supabaseAdmin, deliveryRequestId, sessionId, paymentIntentId } = opts;
  const nowIso = new Date().toISOString();

  const { deliveryRequest, error: readErr } =
    await loadDeliveryRequestForPaymentCheck(supabaseAdmin, deliveryRequestId);

  if (readErr) {
    return { ok: false, error: readErr };
  }

  if (!deliveryRequest) {
    return {
      ok: false,
      error: new Error(`Delivery request not found: ${deliveryRequestId}`),
    };
  }

  if (isPaidStatus(deliveryRequest.payment_status)) {
    console.log("ℹ️ WEBHOOK fallback skipped: delivery_request already paid", {
      deliveryRequestId,
    });
    return { ok: true, used: "already_paid", alreadyPaid: true };
  }

  const attempts: Array<{ label: string; payload: Record<string, unknown> }> = [
    {
      label: "payment_status + paid_at + stripe refs + updated_at",
      payload: {
        payment_status: "paid",
        paid_at: nowIso,
        ...(sessionId ? { stripe_session_id: sessionId } : {}),
        ...(paymentIntentId ? { stripe_payment_intent_id: paymentIntentId } : {}),
        updated_at: nowIso,
      },
    },
    {
      label: "payment_status + paid_at + updated_at",
      payload: {
        payment_status: "paid",
        paid_at: nowIso,
        updated_at: nowIso,
      },
    },
  ];

  let lastErr: unknown = null;

  for (const attempt of attempts) {
    const { error } = await supabaseAdmin
      .from("delivery_requests")
      .update(attempt.payload)
      .eq("id", deliveryRequestId)
      .neq("payment_status", "paid");

    if (!error) {
      console.log("✅ WEBHOOK fallback delivery_request update OK", {
        label: attempt.label,
        deliveryRequestId,
      });
      return { ok: true, used: attempt.label };
    }

    lastErr = error;
    console.log("⚠️ WEBHOOK fallback delivery_request update failed", {
      label: attempt.label,
      code: getErrorCode(error),
      message: getErrorMessage(error),
      details: getErrorDetails(error),
      hint: getErrorHint(error),
    });
  }

  return { ok: false, error: lastErr };
}

async function tryRpcMarkPaid(opts: {
  supabaseAdmin: SupabaseClient;
  orderId: string;
  sessionId: string | null;
  paymentIntentId: string | null;
}) {
  const { supabaseAdmin, orderId, sessionId, paymentIntentId } = opts;

  const rpcArgs = {
    p_order_id: orderId,
    p_session_id: sessionId,
    p_payment_intent_id: paymentIntentId,
  };

  const { data, error } = await supabaseAdmin.rpc("mark_order_paid", rpcArgs);
  return { data, error };
}

async function markOrderPaidRobustly(opts: {
  supabaseAdmin: SupabaseClient;
  orderId: string;
  sessionId: string | null;
  paymentIntentId: string | null;
}): Promise<RobustMarkPaidResult> {
  const { supabaseAdmin, orderId, sessionId, paymentIntentId } = opts;

  const rpc = await tryRpcMarkPaid({
    supabaseAdmin,
    orderId,
    sessionId,
    paymentIntentId,
  });

  if (!rpc.error) {
    const verified = await verifyOrderPaidState({
      supabaseAdmin,
      orderId,
      expectedSessionId: sessionId,
      expectedPaymentIntentId: paymentIntentId,
    });

    if (verified.ok) {
      console.log("✅ WEBHOOK RPC mark_order_paid OK", {
        orderId,
        rpcData: rpc.data,
      });

      return {
        ok: true,
        via: "rpc",
        rpcData: rpc.data,
      };
    }

    console.log("⚠️ WEBHOOK RPC succeeded but verification failed", {
      orderId,
      reason: verified.reason,
      order: verified.order,
    });
  } else {
    console.log("⚠️ WEBHOOK RPC mark_order_paid failed (fallback to update)", {
      orderId,
      code: getErrorCode(rpc.error),
      message: getErrorMessage(rpc.error),
      details: getErrorDetails(rpc.error),
      hint: getErrorHint(rpc.error),
    });
  }

  const fb = await fallbackMarkPaid({
    supabaseAdmin,
    orderId,
    sessionId,
    paymentIntentId,
  });

  if (isFallbackFailure(fb)) {
    return {
      ok: false,
      rpc,
      fallback: fb,
    };
  }

  const verified = await verifyOrderPaidState({
    supabaseAdmin,
    orderId,
    expectedSessionId: sessionId,
    expectedPaymentIntentId: paymentIntentId,
  });

  if (!verified.ok) {
    return {
      ok: false,
      rpc,
      fallback: {
        ok: false,
        error: new Error(`Verification failed after fallback: ${verified.reason}`),
      },
    };
  }

  return {
    ok: true,
    via: "fallback_update",
    used: fb.used,
    already_paid: fb.alreadyPaid ?? false,
  };
}

async function markDeliveryRequestPaidRobustly(opts: {
  supabaseAdmin: SupabaseClient;
  deliveryRequestId: string;
  sessionId: string | null;
  paymentIntentId: string | null;
}): Promise<DeliveryRobustMarkPaidResult> {
  const { supabaseAdmin, deliveryRequestId, sessionId, paymentIntentId } = opts;

  const fb = await fallbackMarkDeliveryRequestPaid({
    supabaseAdmin,
    deliveryRequestId,
    sessionId,
    paymentIntentId,
  });

  if (isDeliveryFallbackFailure(fb)) {
    return {
      ok: false,
      fallback: fb,
    };
  }

  const verified = await verifyDeliveryRequestPaidState({
    supabaseAdmin,
    deliveryRequestId,
    expectedSessionId: sessionId,
    expectedPaymentIntentId: paymentIntentId,
  });

  if (!verified.ok) {
    return {
      ok: false,
      fallback: {
        ok: false,
        error: new Error(
          `Verification failed after fallback: ${verified.reason}`
        ),
      },
    };
  }

  return {
    ok: true,
    via: "fallback_update",
    used: fb.used,
    already_paid: fb.alreadyPaid ?? false,
  };
}

async function handleCheckoutCompletedLikeEvent(
  supabaseAdmin: SupabaseClient,
  event: Stripe.Event
) {
  const session = event.data.object as Stripe.Checkout.Session;
  const metadata = (session.metadata ?? null) as Record<string, unknown> | null;

  const orderId =
    pickOrderIdFromMetadata(metadata) ||
    (session.client_reference_id
      ? String(session.client_reference_id).trim()
      : null);

  const deliveryRequestId = pickDeliveryRequestIdFromMetadata(metadata);

  let paymentIntentId = paymentIntentIdFromUnknown(session.payment_intent);
  const sessionId = normalizeStringOrNull(session.id);
  const sessionAmountTotal = getStripeAmountTotalFromSession(session);
  const sessionCurrency = normalizeCurrency(session.currency);

  console.log(`✅ WEBHOOK ${event.type}`, {
    sessionId,
    orderId,
    deliveryRequestId,
    paymentIntentId,
    amount_total: session.amount_total,
    currency: session.currency,
    payment_status: session.payment_status,
    client_reference_id: session.client_reference_id,
    metadata: session.metadata,
  });

  if (isTaxiStripeModule(metadata)) {
    const taxiRideId = pickTaxiRideIdFromMetadata(metadata);

    if (!taxiRideId) {
      return json({
        received: true,
        ignored: "missing taxi_ride_id for module=taxi",
        type: event.type,
      });
    }

    if (!isCheckoutSessionActuallyPaid(session)) {
      return json({
        received: true,
        ok: true,
        taxi_ride_id: taxiRideId,
        type: event.type,
        ignored: "session_not_paid",
        payment_status: session.payment_status,
      });
    }

    const taxiResult = await handleTaxiStripePayment({
      supabaseAdmin,
      taxiRideId,
      sessionId,
      paymentIntentId,
      expectedAmountCents: getTaxiCheckoutAmountCents(session),
      expectedCurrency: sessionCurrency,
      source: `webhook:${event.type}`,
      metadata,
    });

    if (!taxiResult.ok) {
      return json(
        {
          received: true,
          ok: false,
          error: taxiResult.error,
          taxi_ride_id: taxiRideId,
        },
        taxiResult.error === "taxi_ride_not_found" ? 404 : 500
      );
    }

    return json({
      received: true,
      ok: true,
      taxi_ride_id: taxiRideId,
      already_paid: taxiResult.already_paid ?? false,
      type: event.type,
    });
  }

  if (isMarketplaceStripeModule(metadata)) {
    const sellerOrderId = pickSellerOrderIdFromMetadata(metadata);

    if (!sellerOrderId) {
      return json({
        received: true,
        ignored: "missing seller_order_id for module=marketplace",
        type: event.type,
      });
    }

    if (!isMarketplaceCheckoutSessionPaid(session)) {
      return json({
        received: true,
        ok: true,
        seller_order_id: sellerOrderId,
        type: event.type,
        ignored: "session_not_paid",
        payment_status: session.payment_status,
      });
    }

    const marketplaceResult = await handleMarketplaceStripePayment({
      supabaseAdmin,
      sellerOrderId,
      sessionId,
      paymentIntentId,
      expectedAmountCents: getMarketplaceStripeAmountFromCheckoutSession(session),
      expectedCurrency: sessionCurrency,
      source: `webhook:${event.type}`,
      metadata,
      session,
    });

    if (!marketplaceResult.ok) {
      return json(
        {
          received: true,
          ok: false,
          error: marketplaceResult.error,
          seller_order_id: sellerOrderId,
        },
        marketplaceResult.error === "seller_order_not_found" ? 404 : 500
      );
    }

    return json({
      received: true,
      ok: true,
      seller_order_id: sellerOrderId,
      already_paid: marketplaceResult.already_paid ?? false,
      ignored: marketplaceResult.ignored,
      type: event.type,
    });
  }

  if (!orderId && !deliveryRequestId) {
    return json({
      received: true,
      ignored: "missing orderId/order_id and deliveryRequestId/delivery_request_id",
      type: event.type,
    });
  }

  // Single source of truth (platform-wide): a food/delivery order is only
  // settled when its underlying PaymentIntent is `succeeded`. The Checkout
  // Session `payment_status === "paid"` is NOT trusted on its own — this
  // mirrors the taxi/marketplace handlers and the client confirm paths.
  const settlement = await requirePaymentIntentSucceeded({
    paymentIntentId,
    sessionId,
    session,
  });

  if (isPaymentSettlementFailure(settlement)) {
    console.log("ℹ️ WEBHOOK: checkout session PI not settled yet, ignored", {
      type: event.type,
      orderId,
      deliveryRequestId,
      sessionId,
      payment_status: session.payment_status,
      reason: settlement.reason,
    });

    // Return 200 so Stripe does not retry aggressively; the eventual
    // `payment_intent.succeeded` event will settle the order.
    return json({
      received: true,
      ok: true,
      order_id: orderId,
      delivery_request_id: deliveryRequestId,
      type: event.type,
      ignored: "payment_not_settled",
      reason: settlement.reason,
      payment_status: session.payment_status,
    });
  }

  // Prefer the PaymentIntent id resolved by the settlement authority.
  if (settlement.payment_intent_id) {
    paymentIntentId = settlement.payment_intent_id;
  }

  if (orderId) {
    const { order, error: orderErr } = await loadOrderForPaymentCheck(
      supabaseAdmin,
      orderId
    );

    if (orderErr) {
      console.log("❌ WEBHOOK: order lookup failed", {
        orderId,
        code: getErrorCode(orderErr),
        message: getErrorMessage(orderErr),
      });
      return json(
        { received: true, ok: false, error: "order_lookup_failed" },
        500
      );
    }

    if (!order) {
      console.log("❌ WEBHOOK: order not found", { orderId });
      return json(
        {
          received: true,
          ok: false,
          error: "order_not_found",
          order_id: orderId,
        },
        404
      );
    }

    if (
      order.stripe_session_id &&
      sessionId &&
      order.stripe_session_id !== sessionId
    ) {
      console.log("❌ WEBHOOK: session id mismatch", {
        orderId,
        db_session_id: order.stripe_session_id,
        webhook_session_id: sessionId,
      });
      return json(
        {
          received: true,
          ok: false,
          error: "session_id_mismatch",
          order_id: orderId,
        },
        409
      );
    }

    if (
      order.stripe_payment_intent_id &&
      paymentIntentId &&
      order.stripe_payment_intent_id !== paymentIntentId
    ) {
      console.log("❌ WEBHOOK: payment intent mismatch", {
        orderId,
        db_payment_intent_id: order.stripe_payment_intent_id,
        webhook_payment_intent_id: paymentIntentId,
      });
      return json(
        {
          received: true,
          ok: false,
          error: "payment_intent_mismatch",
          order_id: orderId,
        },
        409
      );
    }

    const expectedAmountCents = resolveOrderAmountCents(order);
    const expectedCurrency = normalizeCurrency(order.currency) ?? "usd";

    if (!expectedAmountCents || !sessionAmountTotal) {
      console.log("❌ WEBHOOK: missing amount for verification", {
        orderId,
        expectedAmountCents,
        sessionAmountTotal,
      });
      return json(
        { received: true, ok: false, error: "amount_verification_failed" },
        400
      );
    }

    if (expectedAmountCents !== sessionAmountTotal) {
      console.log("❌ WEBHOOK: amount mismatch", {
        orderId,
        expectedAmountCents,
        sessionAmountTotal,
        sessionId,
        paymentIntentId,
      });
      return json(
        {
          received: true,
          ok: false,
          error: "amount_mismatch",
          order_id: orderId,
        },
        400
      );
    }

    if (!sessionCurrency || sessionCurrency !== expectedCurrency) {
      console.log("❌ WEBHOOK: currency mismatch", {
        orderId,
        expectedCurrency,
        sessionCurrency,
      });
      return json(
        {
          received: true,
          ok: false,
          error: "currency_mismatch",
          order_id: orderId,
        },
        400
      );
    }

    if (isPaidStatus(order.payment_status)) {
      console.log("ℹ️ WEBHOOK: order already paid", { orderId });
      const walletGate = await requireOrderWalletBridge({
        supabaseAdmin,
        paymentIntentId,
        order,
        source: "webhook:checkout_session:already_paid",
      });
      if (walletGate.ok === false) {
        return walletBridgeFailureResponse({ order_id: orderId }, walletGate.error);
      }
      return json({
        received: true,
        ok: true,
        order_id: orderId,
        via: "already_paid",
        type: event.type,
      });
    }

    const metadataGate = assertWebhookEntityMetadata(
      metadata,
      {
        paymentIntentId,
        sessionId,
        amountCents: sessionAmountTotal,
        currency: sessionCurrency,
      },
      {
        userIds: [order.client_user_id, order.created_by, order.user_id],
        serviceType: "food",
        entityId: orderId,
        entityIdKeys: ["order_id", "orderId"],
      }
    );
    if (!metadataGate.ok) {
      console.log("❌ WEBHOOK: order settlement metadata mismatch", {
        orderId,
        field: metadataGate.field,
        reason: metadataGate.reason,
      });
      return json(
        {
          received: true,
          ok: false,
          error: "payment_expectation_mismatch",
          field: metadataGate.field,
          reason: metadataGate.reason,
          order_id: orderId,
        },
        409
      );
    }

    const walletGate = await requireOrderWalletBridge({
      supabaseAdmin,
      paymentIntentId,
      order,
      source: "webhook:checkout_session",
    });
    if (walletGate.ok === false) {
      return walletBridgeFailureResponse({ order_id: orderId }, walletGate.error);
    }

    const result = await markOrderPaidRobustly({
      supabaseAdmin,
      orderId,
      sessionId,
      paymentIntentId,
    });

    if (isRobustMarkPaidFailure(result)) {
      console.log("❌ WEBHOOK: could not mark order paid", {
        orderId,
        sessionId,
        paymentIntentId,
        rpcCode: getErrorCode(result.rpc.error),
        rpcMessage: getErrorMessage(result.rpc.error),
        fallbackCode: getErrorCode(result.fallback.error),
        fallbackMessage: getErrorMessage(result.fallback.error),
      });

      return json(
        {
          received: true,
          ok: false,
          error: "Could not mark order paid",
          rpc: {
            code: getErrorCode(result.rpc.error),
            message: getErrorMessage(result.rpc.error),
          },
          fallback: {
            code: getErrorCode(result.fallback.error),
            message: getErrorMessage(result.fallback.error),
            details: getErrorDetails(result.fallback.error),
            hint: getErrorHint(result.fallback.error),
          },
        },
        500
      );
    }

    const commissions = await ensureOrderCommissionsReady(
      supabaseAdmin,
      orderId,
      "webhook:checkout_session"
    );

    if (commissions.ok === false) {
      console.error("[webhook] order commissions refresh failed", {
        order_id: orderId,
        error: commissions.error,
      });
      return json(
        {
          received: true,
          ok: false,
          error: "order_commissions_refresh_failed",
          order_id: orderId,
          details: commissions.error,
        },
        500
      );
    }

    const { data: paidOrder } = await supabaseAdmin
      .from("orders")
      .select(ORDER_POST_PAID_SELECT)
      .eq("id", orderId)
      .maybeSingle();

    if (paidOrder && String(paidOrder.kind ?? "").toLowerCase() === "food") {
      const { completeFoodOrderAfterPayment } = await import(
        "@/lib/foodOrderPaymentCompletion"
      );
      await completeFoodOrderAfterPayment(supabaseAdmin, {
        orderId,
        clientUserIds: [paidOrder.client_user_id, paidOrder.created_by],
        kind: paidOrder.kind,
        dispatchOrigin: getDispatchSiteOrigin(),
      });
      try {
        const { enqueuePaymentSucceeded } = await import(
          "@/lib/finance/financeEvents"
        );
        await enqueuePaymentSucceeded({
          supabaseAdmin,
          entityType: "order",
          entityId: orderId,
          vertical: "food",
          amountCents: Number(paidOrder.total_cents ?? 0),
          currency: paidOrder.currency ?? "USD",
          countryCode: resolveOrderPlatformCountry(paidOrder),
          paymentIntentId,
        });
      } catch (e) {
        console.warn(
          "[finance] food_paid enqueue fail-open",
          e instanceof Error ? e.message : e
        );
      }
    }

    return json({
      received: true,
      ok: true,
      order_id: orderId,
      via: result.via,
      used: result.used,
      already_paid: result.already_paid ?? false,
      type: event.type,
    });
  }

  if (!deliveryRequestId) {
    return json({
      received: true,
      ignored: "missing deliveryRequestId/delivery_request_id",
      type: event.type,
    });
  }

  const { deliveryRequest, error: deliveryErr } =
    await loadDeliveryRequestForPaymentCheck(supabaseAdmin, deliveryRequestId);

  if (deliveryErr) {
    console.log("❌ WEBHOOK: delivery_request lookup failed", {
      deliveryRequestId,
      code: getErrorCode(deliveryErr),
      message: getErrorMessage(deliveryErr),
    });
    return json(
      { received: true, ok: false, error: "delivery_request_lookup_failed" },
      500
    );
  }

  if (!deliveryRequest) {
    console.log("❌ WEBHOOK: delivery_request not found", { deliveryRequestId });
    return json(
      {
        received: true,
        ok: false,
        error: "delivery_request_not_found",
        delivery_request_id: deliveryRequestId,
      },
      404
    );
  }

  if (
    deliveryRequest.stripe_session_id &&
    sessionId &&
    deliveryRequest.stripe_session_id !== sessionId
  ) {
    console.log("❌ WEBHOOK: delivery_request session id mismatch", {
      deliveryRequestId,
      db_session_id: deliveryRequest.stripe_session_id,
      webhook_session_id: sessionId,
    });
    return json(
      {
        received: true,
        ok: false,
        error: "delivery_request_session_id_mismatch",
        delivery_request_id: deliveryRequestId,
      },
      409
    );
  }

  if (
    deliveryRequest.stripe_payment_intent_id &&
    paymentIntentId &&
    deliveryRequest.stripe_payment_intent_id !== paymentIntentId
  ) {
    console.log("❌ WEBHOOK: delivery_request payment intent mismatch", {
      deliveryRequestId,
      db_payment_intent_id: deliveryRequest.stripe_payment_intent_id,
      webhook_payment_intent_id: paymentIntentId,
    });
    return json(
      {
        received: true,
        ok: false,
        error: "delivery_request_payment_intent_mismatch",
        delivery_request_id: deliveryRequestId,
      },
      409
    );
  }

  const expectedAmountCents =
    resolveDeliveryRequestAmountCents(deliveryRequest);
  const expectedCurrency =
    normalizeCurrency(deliveryRequest.currency) ?? "usd";

  if (!expectedAmountCents || !sessionAmountTotal) {
    console.log("❌ WEBHOOK: delivery_request missing amount for verification", {
      deliveryRequestId,
      expectedAmountCents,
      sessionAmountTotal,
    });
    return json(
      { received: true, ok: false, error: "amount_verification_failed" },
      400
    );
  }

  if (expectedAmountCents !== sessionAmountTotal) {
    console.log("❌ WEBHOOK: delivery_request amount mismatch", {
      deliveryRequestId,
      expectedAmountCents,
      sessionAmountTotal,
      sessionId,
      paymentIntentId,
    });
    return json(
      {
        received: true,
        ok: false,
        error: "delivery_request_amount_mismatch",
        delivery_request_id: deliveryRequestId,
      },
      400
    );
  }

  if (!sessionCurrency || sessionCurrency !== expectedCurrency) {
    console.log("❌ WEBHOOK: delivery_request currency mismatch", {
      deliveryRequestId,
      expectedCurrency,
      sessionCurrency,
    });
    return json(
      {
        received: true,
        ok: false,
        error: "delivery_request_currency_mismatch",
        delivery_request_id: deliveryRequestId,
      },
      400
    );
  }

  if (isPaidStatus(deliveryRequest.payment_status)) {
    console.log("ℹ️ WEBHOOK: delivery_request already paid", {
      deliveryRequestId,
    });
    const walletGate = await requireDeliveryRequestWalletBridge({
      supabaseAdmin,
      paymentIntentId,
      deliveryRequest,
      source: "webhook:checkout_session:already_paid",
    });
    if (walletGate.ok === false) {
      return walletBridgeFailureResponse(
        { delivery_request_id: deliveryRequestId },
        walletGate.error,
      );
    }
    return json({
      received: true,
      ok: true,
      delivery_request_id: deliveryRequestId,
      via: "already_paid",
      type: event.type,
    });
  }

  const deliveryMetadataGate = assertWebhookEntityMetadata(
    metadata,
    {
      paymentIntentId,
      sessionId,
      amountCents: sessionAmountTotal,
      currency: sessionCurrency,
    },
    {
      userIds: [deliveryRequest.created_by, deliveryRequest.client_user_id],
      serviceType: "delivery",
      entityId: deliveryRequestId,
      entityIdKeys: ["delivery_request_id", "deliveryRequestId"],
    }
  );
  if (!deliveryMetadataGate.ok) {
    console.log("❌ WEBHOOK: delivery_request settlement metadata mismatch", {
      deliveryRequestId,
      field: deliveryMetadataGate.field,
      reason: deliveryMetadataGate.reason,
    });
    return json(
      {
        received: true,
        ok: false,
        error: "payment_expectation_mismatch",
        field: deliveryMetadataGate.field,
        reason: deliveryMetadataGate.reason,
        delivery_request_id: deliveryRequestId,
      },
      409
    );
  }

  const walletGateDr = await requireDeliveryRequestWalletBridge({
    supabaseAdmin,
    paymentIntentId,
    deliveryRequest,
    source: "webhook:checkout_session",
  });
  if (walletGateDr.ok === false) {
    return walletBridgeFailureResponse(
      { delivery_request_id: deliveryRequestId },
      walletGateDr.error,
    );
  }

  const result = await markDeliveryRequestPaidRobustly({
    supabaseAdmin,
    deliveryRequestId,
    sessionId,
    paymentIntentId,
  });

if (isDeliveryRobustMarkPaidFailure(result)) {
  console.log("❌ WEBHOOK: could not mark delivery_request paid (PI)", {
    deliveryRequestId,
    paymentIntentId,
    fallbackCode: getErrorCode(result.fallback.error),
    fallbackMessage: getErrorMessage(result.fallback.error),
  });

  return json(
    {
      received: true,
      ok: false,
      error: "Could not mark delivery_request paid (PI)",
      fallback: {
        code: getErrorCode(result.fallback.error),
        message: getErrorMessage(result.fallback.error),
        details: getErrorDetails(result.fallback.error),
        hint: getErrorHint(result.fallback.error),
      },
    },
    500
  );
}

const { error: releaseOrderError } = await supabaseAdmin
  .from("orders")
  .update({ status: "pending" })
  .eq("external_ref_id", deliveryRequestId)
  .eq("external_ref_type", "delivery_request")
  .eq("status", "waiting_payment");

if (releaseOrderError) {
  console.log("❌ WEBHOOK PI: failed to release order to drivers", {
    deliveryRequestId,
    code: getErrorCode(releaseOrderError),
    message: getErrorMessage(releaseOrderError),
    details: getErrorDetails(releaseOrderError),
    hint: getErrorHint(releaseOrderError),
  });

  return json(
    {
      received: true,
      ok: false,
      error: "delivery_request_paid_but_order_not_released",
      delivery_request_id: deliveryRequestId,
    },
    500
  );
}

console.log("✅ WEBHOOK PI: order released to drivers", {
  deliveryRequestId,
});

await refreshCommissionsForDeliveryRequest(supabaseAdmin, deliveryRequestId);

  const dispatchOriginCheckout = getDispatchSiteOrigin();
  if (dispatchOriginCheckout) {
    scheduleDeliveryRequestDispatch({
      origin: dispatchOriginCheckout,
      deliveryRequestId,
    });
  }

return json({
  received: true,
  ok: true,
  delivery_request_id: deliveryRequestId,
  via: result.via,
  used: result.used,
  already_paid: result.already_paid ?? false,
  type: event.type,
});}

async function handlePaymentIntentSucceeded(
  supabaseAdmin: SupabaseClient,
  event: Stripe.Event
) {
  const pi = event.data.object as Stripe.PaymentIntent;
  const metadata = (pi.metadata ?? null) as Record<string, unknown> | null;

  const orderIdFromMd = pickOrderIdFromMetadata(metadata);
  const deliveryRequestIdFromMd = pickDeliveryRequestIdFromMetadata(metadata);
  const paymentIntentId = pi.id;
  const piAmount = getStripeAmountFromPaymentIntent(pi);
  const piCurrency = normalizeCurrency(pi.currency);
  const stripeFeeSnapshot = await getStripeFeeSnapshot(paymentIntentId);

  console.log("✅ WEBHOOK payment_intent.succeeded", {
    paymentIntentId,
    orderIdFromMd,
    deliveryRequestIdFromMd,
    metadata: pi.metadata,
    amount: pi.amount,
    currency: pi.currency,
    status: pi.status,
    stripe_fee_cents: stripeFeeSnapshot.stripe_fee_cents,
    stripe_net_cents: stripeFeeSnapshot.stripe_net_cents,
  });

  if (isTaxiStripeModule(metadata)) {
    const taxiRideId = pickTaxiRideIdFromMetadata(metadata);

    if (!taxiRideId) {
      return json({
        received: true,
        ignored: "missing taxi_ride_id for module=taxi",
        type: event.type,
      });
    }

    const taxiResult = await handleTaxiStripePayment({
      supabaseAdmin,
      taxiRideId,
      paymentIntentId,
      expectedAmountCents: getStripeAmountFromPaymentIntent(pi),
      expectedCurrency: piCurrency,
      source: "webhook:payment_intent.succeeded",
      paymentIntent: pi,
      metadata,
    });

    if (!taxiResult.ok) {
      return json(
        {
          received: true,
          ok: false,
          error: taxiResult.error,
          taxi_ride_id: taxiRideId,
        },
        taxiResult.error === "taxi_ride_not_found" ? 404 : 500
      );
    }

    return json({
      received: true,
      ok: true,
      taxi_ride_id: taxiRideId,
      already_paid: taxiResult.already_paid ?? false,
      type: event.type,
    });
  }

  if (isMarketplaceStripeModule(metadata)) {
    const sellerOrderId = pickSellerOrderIdFromMetadata(metadata);

    if (!sellerOrderId) {
      return json({
        received: true,
        ignored: "missing seller_order_id for module=marketplace",
        type: event.type,
      });
    }

    const marketplaceResult = await handleMarketplaceStripePayment({
      supabaseAdmin,
      sellerOrderId,
      paymentIntentId,
      expectedAmountCents: getMarketplaceStripeAmountFromPaymentIntent(pi),
      expectedCurrency: piCurrency,
      source: "webhook:payment_intent.succeeded",
      metadata,
      paymentIntent: pi,
    });

    if (!marketplaceResult.ok) {
      return json(
        {
          received: true,
          ok: false,
          error: marketplaceResult.error,
          seller_order_id: sellerOrderId,
        },
        marketplaceResult.error === "seller_order_not_found" ? 404 : 500
      );
    }

    return json({
      received: true,
      ok: true,
      seller_order_id: sellerOrderId,
      already_paid: marketplaceResult.already_paid ?? false,
      ignored: marketplaceResult.ignored,
      type: event.type,
    });
  }

  let orderId: string | null = orderIdFromMd;

  if (!orderId) {
    const { data: found, error: findErr } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (findErr) {
      console.log(
        "⚠️ WEBHOOK: could not lookup order by stripe_payment_intent_id",
        {
          code: getErrorCode(findErr),
          message: getErrorMessage(findErr),
        }
      );
    }

    orderId = found?.id ?? null;
  }

  if (orderId) {
    const { order, error: orderErr } = await loadOrderForPaymentCheck(
      supabaseAdmin,
      orderId
    );

    if (orderErr) {
      console.log("❌ WEBHOOK PI: order lookup failed", {
        orderId,
        code: getErrorCode(orderErr),
        message: getErrorMessage(orderErr),
      });
      return json(
        { received: true, ok: false, error: "order_lookup_failed" },
        500
      );
    }

    if (!order) {
      return json(
        {
          received: true,
          ok: false,
          error: "order_not_found",
          order_id: orderId,
        },
        404
      );
    }

    if (
      order.stripe_payment_intent_id &&
      order.stripe_payment_intent_id !== paymentIntentId
    ) {
      console.log("❌ WEBHOOK PI: payment intent mismatch", {
        orderId,
        db_payment_intent_id: order.stripe_payment_intent_id,
        webhook_payment_intent_id: paymentIntentId,
      });
      return json(
        {
          received: true,
          ok: false,
          error: "payment_intent_mismatch",
          order_id: orderId,
        },
        409
      );
    }

    const expectedAmountCents = resolveOrderAmountCents(order);
    const expectedCurrency = normalizeCurrency(order.currency) ?? "usd";

    if (!expectedAmountCents || !piAmount) {
      console.log("❌ WEBHOOK PI: missing amount for verification", {
        orderId,
        expectedAmountCents,
        piAmount,
      });
      return json(
        { received: true, ok: false, error: "amount_verification_failed" },
        400
      );
    }

    if (expectedAmountCents !== piAmount) {
      console.log("❌ WEBHOOK PI: amount mismatch", {
        orderId,
        expectedAmountCents,
        piAmount,
      });
      return json(
        {
          received: true,
          ok: false,
          error: "amount_mismatch",
          order_id: orderId,
        },
        400
      );
    }

    if (!piCurrency || piCurrency !== expectedCurrency) {
      console.log("❌ WEBHOOK PI: currency mismatch", {
        orderId,
        expectedCurrency,
        piCurrency,
      });
      return json(
        {
          received: true,
          ok: false,
          error: "currency_mismatch",
          order_id: orderId,
        },
        400
      );
    }

    if (isPaidStatus(order.payment_status)) {
      console.log("ℹ️ WEBHOOK PI: order already paid", { orderId });

      await persistStripeFeeSnapshot({
        supabaseAdmin,
        paymentIntentId,
        snapshot: stripeFeeSnapshot,
        orderId,
      });

      const walletGate = await requireOrderWalletBridge({
        supabaseAdmin,
        paymentIntentId,
        order,
        source: "webhook:payment_intent.succeeded:already_paid",
      });
      if (walletGate.ok === false) {
        return walletBridgeFailureResponse({ order_id: orderId }, walletGate.error);
      }

      return json({
        received: true,
        ok: true,
        order_id: orderId,
        via: "already_paid",
        type: event.type,
      });
    }

    const metadataGatePi = assertWebhookEntityMetadata(
      metadata,
      {
        paymentIntentId,
        sessionId: order.stripe_session_id ?? null,
        amountCents: piAmount,
        currency: piCurrency,
      },
      {
        userIds: [order.client_user_id, order.created_by, order.user_id],
        serviceType: "food",
        entityId: orderId,
        entityIdKeys: ["order_id", "orderId"],
      }
    );
    if (!metadataGatePi.ok) {
      console.log("❌ WEBHOOK PI: order settlement metadata mismatch", {
        orderId,
        field: metadataGatePi.field,
        reason: metadataGatePi.reason,
      });
      return json(
        {
          received: true,
          ok: false,
          error: "payment_expectation_mismatch",
          field: metadataGatePi.field,
          reason: metadataGatePi.reason,
          order_id: orderId,
        },
        409
      );
    }

    const walletGatePi = await requireOrderWalletBridge({
      supabaseAdmin,
      paymentIntentId,
      order,
      source: "webhook:payment_intent.succeeded",
    });
    if (walletGatePi.ok === false) {
      return walletBridgeFailureResponse({ order_id: orderId }, walletGatePi.error);
    }

    const result = await markOrderPaidRobustly({
      supabaseAdmin,
      orderId,
      sessionId: order.stripe_session_id ?? null,
      paymentIntentId,
    });

    if (isRobustMarkPaidFailure(result)) {
      console.log("❌ WEBHOOK: could not mark order paid (PI)", {
        orderId,
        paymentIntentId,
        rpcCode: getErrorCode(result.rpc.error),
        rpcMessage: getErrorMessage(result.rpc.error),
        fallbackCode: getErrorCode(result.fallback.error),
        fallbackMessage: getErrorMessage(result.fallback.error),
      });

      return json(
        {
          received: true,
          ok: false,
          error: "Could not mark order paid (PI)",
          rpc: {
            code: getErrorCode(result.rpc.error),
            message: getErrorMessage(result.rpc.error),
          },
          fallback: {
            code: getErrorCode(result.fallback.error),
            message: getErrorMessage(result.fallback.error),
            details: getErrorDetails(result.fallback.error),
            hint: getErrorHint(result.fallback.error),
          },
        },
        500
      );
    }

    await persistStripeFeeSnapshot({
      supabaseAdmin,
      paymentIntentId,
      snapshot: stripeFeeSnapshot,
      orderId,
    });

    const commissionsPi = await ensureOrderCommissionsReady(
      supabaseAdmin,
      orderId,
      "webhook:payment_intent"
    );

    if (commissionsPi.ok === false) {
      console.error("[webhook] order commissions refresh failed (PI)", {
        order_id: orderId,
        error: commissionsPi.error,
      });
      return json(
        {
          received: true,
          ok: false,
          error: "order_commissions_refresh_failed",
          order_id: orderId,
          details: commissionsPi.error,
        },
        500
      );
    }

    const { data: paidOrderPi } = await supabaseAdmin
      .from("orders")
      .select(ORDER_POST_PAID_SELECT)
      .eq("id", orderId)
      .maybeSingle();

    if (paidOrderPi && String(paidOrderPi.kind ?? "").toLowerCase() === "food") {
      const { completeFoodOrderAfterPayment } = await import(
        "@/lib/foodOrderPaymentCompletion"
      );
      await completeFoodOrderAfterPayment(supabaseAdmin, {
        orderId,
        clientUserIds: [paidOrderPi.client_user_id, paidOrderPi.created_by],
        kind: paidOrderPi.kind,
        dispatchOrigin: getDispatchSiteOrigin(),
      });
      try {
        const { enqueuePaymentSucceeded } = await import(
          "@/lib/finance/financeEvents"
        );
        await enqueuePaymentSucceeded({
          supabaseAdmin,
          entityType: "order",
          entityId: orderId,
          vertical: "food",
          amountCents: Number(paidOrderPi.total_cents ?? 0),
          currency: paidOrderPi.currency ?? "USD",
          countryCode: resolveOrderPlatformCountry(paidOrderPi),
          paymentIntentId,
        });
      } catch (e) {
        console.warn(
          "[finance] food_paid enqueue fail-open",
          e instanceof Error ? e.message : e
        );
      }
    }

    return json({
      received: true,
      ok: true,
      order_id: orderId,
      via: result.via,
      used: result.used,
      already_paid: result.already_paid ?? false,
      type: event.type,
    });
  }

  let deliveryRequestId: string | null = deliveryRequestIdFromMd;

  if (!deliveryRequestId) {
    const { data: found, error: findErr } = await supabaseAdmin
      .from("delivery_requests")
      .select("id")
      .eq("stripe_payment_intent_id", paymentIntentId)
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (findErr) {
      console.log(
        "⚠️ WEBHOOK: could not lookup delivery_request by stripe_payment_intent_id",
        {
          code: getErrorCode(findErr),
          message: getErrorMessage(findErr),
        }
      );
    }

    deliveryRequestId = found?.id ?? null;
  }

  if (!deliveryRequestId) {
    console.log(
      "⚠️ WEBHOOK PI succeeded ignored: cannot resolve orderId or deliveryRequestId",
      {
        paymentIntentId,
      }
    );
    return json({
      received: true,
      ignored: "cannot_resolve_order_id_or_delivery_request_id",
      type: event.type,
    });
  }

  const { deliveryRequest, error: deliveryErr } =
    await loadDeliveryRequestForPaymentCheck(supabaseAdmin, deliveryRequestId);

  if (deliveryErr) {
    console.log("❌ WEBHOOK PI: delivery_request lookup failed", {
      deliveryRequestId,
      code: getErrorCode(deliveryErr),
      message: getErrorMessage(deliveryErr),
    });
    return json(
      { received: true, ok: false, error: "delivery_request_lookup_failed" },
      500
    );
  }

  if (!deliveryRequest) {
    return json(
      {
        received: true,
        ok: false,
        error: "delivery_request_not_found",
        delivery_request_id: deliveryRequestId,
      },
      404
    );
  }

  if (
    deliveryRequest.stripe_payment_intent_id &&
    deliveryRequest.stripe_payment_intent_id !== paymentIntentId
  ) {
    console.log("❌ WEBHOOK PI: delivery_request payment intent mismatch", {
      deliveryRequestId,
      db_payment_intent_id: deliveryRequest.stripe_payment_intent_id,
      webhook_payment_intent_id: paymentIntentId,
    });
    return json(
      {
        received: true,
        ok: false,
        error: "delivery_request_payment_intent_mismatch",
        delivery_request_id: deliveryRequestId,
      },
      409
    );
  }

  const expectedAmountCents =
    resolveDeliveryRequestAmountCents(deliveryRequest);
  const expectedCurrency =
    normalizeCurrency(deliveryRequest.currency) ?? "usd";

  if (!expectedAmountCents || !piAmount) {
    console.log("❌ WEBHOOK PI: delivery_request missing amount for verification", {
      deliveryRequestId,
      expectedAmountCents,
      piAmount,
    });
    return json(
      { received: true, ok: false, error: "amount_verification_failed" },
      400
    );
  }

  if (expectedAmountCents !== piAmount) {
    console.log("❌ WEBHOOK PI: delivery_request amount mismatch", {
      deliveryRequestId,
      expectedAmountCents,
      piAmount,
    });
    return json(
      {
        received: true,
        ok: false,
        error: "delivery_request_amount_mismatch",
        delivery_request_id: deliveryRequestId,
      },
      400
    );
  }

  if (!piCurrency || piCurrency !== expectedCurrency) {
    console.log("❌ WEBHOOK PI: delivery_request currency mismatch", {
      deliveryRequestId,
      expectedCurrency,
      piCurrency,
    });
    return json(
      {
        received: true,
        ok: false,
        error: "delivery_request_currency_mismatch",
        delivery_request_id: deliveryRequestId,
      },
      400
    );
  }

  if (isPaidStatus(deliveryRequest.payment_status)) {
    console.log("ℹ️ WEBHOOK PI: delivery_request already paid", {
      deliveryRequestId,
    });

    await persistStripeFeeSnapshot({
      supabaseAdmin,
      paymentIntentId,
      snapshot: stripeFeeSnapshot,
      deliveryRequestId,
    });

    const walletGate = await requireDeliveryRequestWalletBridge({
      supabaseAdmin,
      paymentIntentId,
      deliveryRequest,
      source: "webhook:payment_intent.succeeded:already_paid",
    });
    if (walletGate.ok === false) {
      return walletBridgeFailureResponse(
        { delivery_request_id: deliveryRequestId },
        walletGate.error,
      );
    }

    return json({
      received: true,
      ok: true,
      delivery_request_id: deliveryRequestId,
      via: "already_paid",
      type: event.type,
    });
  }

  const deliveryMetadataGatePi = assertWebhookEntityMetadata(
    metadata,
    {
      paymentIntentId,
      sessionId: deliveryRequest.stripe_session_id ?? null,
      amountCents: piAmount,
      currency: piCurrency,
    },
    {
      userIds: [deliveryRequest.created_by, deliveryRequest.client_user_id],
      serviceType: "delivery",
      entityId: deliveryRequestId,
      entityIdKeys: ["delivery_request_id", "deliveryRequestId"],
    }
  );
  if (!deliveryMetadataGatePi.ok) {
    console.log("❌ WEBHOOK PI: delivery_request settlement metadata mismatch", {
      deliveryRequestId,
      field: deliveryMetadataGatePi.field,
      reason: deliveryMetadataGatePi.reason,
    });
    return json(
      {
        received: true,
        ok: false,
        error: "payment_expectation_mismatch",
        field: deliveryMetadataGatePi.field,
        reason: deliveryMetadataGatePi.reason,
        delivery_request_id: deliveryRequestId,
      },
      409
    );
  }

  const walletGateDrPi = await requireDeliveryRequestWalletBridge({
    supabaseAdmin,
    paymentIntentId,
    deliveryRequest,
    source: "webhook:payment_intent.succeeded",
  });
  if (walletGateDrPi.ok === false) {
    return walletBridgeFailureResponse(
      { delivery_request_id: deliveryRequestId },
      walletGateDrPi.error,
    );
  }

  const result = await markDeliveryRequestPaidRobustly({
    supabaseAdmin,
    deliveryRequestId,
    sessionId: deliveryRequest.stripe_session_id ?? null,
    paymentIntentId,
  });

if (isDeliveryRobustMarkPaidFailure(result)) {
  console.log("❌ WEBHOOK: could not mark delivery_request paid (PI)", {
    deliveryRequestId,
    paymentIntentId,
    fallbackCode: getErrorCode(result.fallback.error),
    fallbackMessage: getErrorMessage(result.fallback.error),
  });

  return json(
    {
      received: true,
      ok: false,
      error: "Could not mark delivery_request paid (PI)",
      fallback: {
        code: getErrorCode(result.fallback.error),
        message: getErrorMessage(result.fallback.error),
        details: getErrorDetails(result.fallback.error),
        hint: getErrorHint(result.fallback.error),
      },
    },
    500
  );
}

const { error: releaseOrderError } = await supabaseAdmin
  .from("orders")
  .update({ status: "pending" })
  .eq("external_ref_id", deliveryRequestId)
  .eq("external_ref_type", "delivery_request")
  .eq("status", "waiting_payment");

if (releaseOrderError) {
  console.log("❌ WEBHOOK PI: failed to release order to drivers", {
    deliveryRequestId,
    code: getErrorCode(releaseOrderError),
    message: getErrorMessage(releaseOrderError),
    details: getErrorDetails(releaseOrderError),
    hint: getErrorHint(releaseOrderError),
  });

  return json(
    {
      received: true,
      ok: false,
      error: "delivery_request_paid_but_order_not_released",
      delivery_request_id: deliveryRequestId,
    },
    500
  );
}

console.log("✅ WEBHOOK PI: order released to drivers", {
  deliveryRequestId,
});

await persistStripeFeeSnapshot({
  supabaseAdmin,
  paymentIntentId,
  snapshot: stripeFeeSnapshot,
  deliveryRequestId,
});

await refreshCommissionsForDeliveryRequest(supabaseAdmin, deliveryRequestId);

  const dispatchOriginPi = getDispatchSiteOrigin();
  if (dispatchOriginPi) {
    scheduleDeliveryRequestDispatch({
      origin: dispatchOriginPi,
      deliveryRequestId,
    });
  }

return json({
  received: true,
  ok: true,
  delivery_request_id: deliveryRequestId,
  via: result.via,
  used: result.used,
  already_paid: result.already_paid ?? false,
  type: event.type,
});}

export async function POST(req: NextRequest) {
  try {
    if (!webhookSecret) {
      return json({ error: "Missing STRIPE_WEBHOOK_SECRET" }, 500);
    }

    const sig = req.headers.get("stripe-signature");
    if (!sig) {
      return json({ error: "Missing stripe-signature" }, 400);
    }

    const rawBody = await getRawBody(req);

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (e: unknown) {
      console.log("❌ WEBHOOK signature error", getErrorMessage(e));
      return new NextResponse("Webhook signature verification failed", {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
          Pragma: "no-cache",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    // Reject Stripe test-mode events against production deployments.
    const isProd =
      process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production";
    const allowTestInProd =
      String(process.env.STRIPE_ALLOW_TEST_EVENTS_IN_PROD ?? "")
        .trim()
        .toLowerCase() === "true";
    if (isProd && event.livemode === false && !allowTestInProd) {
      return json(
        {
          received: true,
          ignored: "test_mode_event_rejected_in_production",
          type: event.type,
        },
        200
      );
    }

    if (!HANDLED_EVENT_TYPES.has(event.type)) {
      return json({
        received: true,
        type: event.type,
        ignored: "unhandled_event_type",
      });
    }

    const supabaseAdmin = getSupabaseAdmin();

    const persisted = await persistStripeEvent({ supabaseAdmin, event });

    if (persisted.duplicate) {
      const needsRecovery = await stripeEventNeedsReprocessing(
        supabaseAdmin,
        event
      );

      if (!needsRecovery) {
        return json({
          received: true,
          duplicate: true,
          skipped: "already_complete",
          type: event.type,
          event_id: event.id,
        });
      }

      console.log("ℹ️ WEBHOOK: duplicate event — reprocessing unpaid target", {
        event_id: event.id,
        type: event.type,
      });
    } else if (!persisted.inserted) {
      console.log("❌ WEBHOOK: idempotency record failed — skipping handler", {
        event_id: event.id,
        type: event.type,
        failed: persisted.failed,
      });

      return json(
        {
          received: true,
          ok: false,
          error: "webhook_idempotency_record_failed",
          event_id: event.id,
          type: event.type,
        },
        503
      );
    }

    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      // Phase 6: MMD+ client subscriptions, then Phase 5 partner subscriptions.
      const mmdPlusCheckout = await handleMmdPlusStripeEvent(supabaseAdmin, event);
      if (mmdPlusCheckout.handled) {
        return json({
          received: true,
          type: event.type,
          ok: true,
          mmd_plus: mmdPlusCheckout.result ?? {},
        });
      }
      const subResult = await handleSubscriptionStripeEvent(supabaseAdmin, event);
      if (subResult.handled) {
        return json({
          received: true,
          type: event.type,
          ok: true,
          subscriptions: subResult.result ?? {},
        });
      }
      return await handleCheckoutCompletedLikeEvent(supabaseAdmin, event);
    }

    if (
      event.type === "customer.subscription.created" ||
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted" ||
      event.type === "invoice.paid" ||
      event.type === "invoice.payment_succeeded" ||
      event.type === "invoice.payment_failed"
    ) {
      const mmdPlusResult = await handleMmdPlusStripeEvent(supabaseAdmin, event);
      if (mmdPlusResult.handled) {
        return json({
          received: true,
          type: event.type,
          ok: true,
          handled: true,
          mmd_plus: mmdPlusResult.result ?? {},
        });
      }
      const subResult = await handleSubscriptionStripeEvent(supabaseAdmin, event);
      return json({
        received: true,
        type: event.type,
        ok: true,
        handled: subResult.handled,
        subscriptions: subResult.result ?? {},
      });
    }

    if (event.type === "payment_intent.succeeded") {
      return await handlePaymentIntentSucceeded(supabaseAdmin, event);
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      const result = await handleCheckoutSessionExpiredEvent({
        supabaseAdmin,
        session,
        eventType: event.type,
      });
      return json(result);
    }

    if (event.type === "payment_intent.payment_failed") {
      const paymentIntent = event.data.object as Stripe.PaymentIntent;
      const result = await handlePaymentIntentFailedEvent({
        supabaseAdmin,
        paymentIntent,
        eventType: event.type,
      });
      return json(result);
    }

    if (event.type === "charge.refunded") {
      const charge = event.data.object as Stripe.Charge;
      const result = await syncStripeChargeRefunded({ supabaseAdmin, charge });
      return json({
        received: true,
        type: event.type,
        ok: true,
        refund_sync: result,
      });
    }

    if (event.type === "refund.updated") {
      const refund = event.data.object as Stripe.Refund;
      if (String(refund.status ?? "").toLowerCase() !== "succeeded") {
        return json({
          received: true,
          type: event.type,
          ignored: "refund_not_succeeded",
          status: refund.status ?? null,
        });
      }
      const result = await syncStripeRefundObject({ supabaseAdmin, refund });
      return json({
        received: true,
        type: event.type,
        ok: true,
        refund_sync: result,
      });
    }

    return json({
      received: true,
      type: event.type,
      ignored: "unhandled_event_type",
    });
  } catch (e: unknown) {
    const message = getErrorMessage(e);

    if (message === "Webhook body too large") {
      return json({ error: "Webhook body too large" }, 413);
    }

    console.log("❌ WEBHOOK crash", message);
    return json({ error: "Internal server error" }, 500);
  }
}

export async function GET() {
  return methodNotAllowed();
}

export async function PUT() {
  return methodNotAllowed();
}

export async function PATCH() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}