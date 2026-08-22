import { NextRequest, NextResponse } from "next/server";
import {
  createClient,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";
import { completeFoodOrderAfterPayment } from "@/lib/foodOrderPaymentCompletion";
import { resolveOrderAmountCents } from "@/lib/orderAmountCents";
import { ensureOrderCommissionsReady } from "@/lib/refreshOrderCommissions";
import {
  gateOrderPlatformFeature,
  orderVerticalForPlatformGate,
} from "@/lib/platformRouteGuards";
import { logTechnicalError, toUserFacingError } from "@/lib/userFacingError";
import { bridgeStripeWalletFromPaidOrder } from "@/lib/stripeInboundWalletBridge";
import {
  requirePaymentIntentSucceeded,
  evaluateStripeSettlement,
  assertSettlementMatchesExpectation,
} from "@/lib/requirePaymentIntentSucceeded";
import { ORDER_CONFIRM_PAID_SELECT } from "@/lib/orderPaymentSelect";
import { resolveOrderPlatformCountry } from "@/lib/platformCountryResolver";
import { materializePaidFoodOrderFromQuoteCheckout } from "@/lib/food/foodCheckoutFromQuote";
import { getStripeAmountFromCheckoutSession } from "@/lib/taxiStripeWebhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  orderId?: string;
  order_id?: string;
  foodCheckoutId?: string;
  food_checkout_id?: string;
  sessionId?: string;
  session_id?: string;
};

type OrderRow = {
  id: string;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  payment_status: string | null;
  client_user_id: string | null;
  created_by: string | null;
  kind: string | null;
  total_cents: number | null;
  total: number | null;
  grand_total: number | null;
  currency: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
};

type VerifyOrderRow = {
  id: string;
  payment_status: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
};

type GenericErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

type VerifyPaidStateSuccess = {
  ok: true;
  reason: "verified";
  error: null;
  order: VerifyOrderRow;
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
  order: VerifyOrderRow | null;
};

type VerifyPaidStateResult = VerifyPaidStateSuccess | VerifyPaidStateFailure;

function asErrorLike(value: unknown): GenericErrorLike | null {
  if (!value || typeof value !== "object") return null;
  return value as GenericErrorLike;
}

function getErrorMessage(value: unknown): string {
  if (value instanceof Error && value.message) return value.message;

  const err = asErrorLike(value);
  if (typeof err?.message === "string" && err.message.trim()) {
    return err.message;
  }

  return "Unknown error";
}

function getErrorCode(value: unknown): string | null {
  const err = asErrorLike(value);
  return typeof err?.code === "string" ? err.code : null;
}

function getErrorDetails(value: unknown): string | null {
  const err = asErrorLike(value);
  return typeof err?.details === "string" ? err.details : null;
}

function getErrorHint(value: unknown): string | null {
  const err = asErrorLike(value);
  return typeof err?.hint === "string" ? err.hint : null;
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function logSupabaseError(
  prefix: string,
  err: unknown,
  extra?: Record<string, unknown>
) {
  console.error(prefix, {
    code: getErrorCode(err),
    message: getErrorMessage(err),
    details: getErrorDetails(err),
    hint: getErrorHint(err),
    ...extra,
  });
}

function isPaidStatus(status: unknown): boolean {
  return String(status ?? "").trim().toLowerCase() === "paid";
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function paymentIntentIdFromUnknown(value: unknown): string | null {
  if (isNonEmptyString(value)) return value.trim();

  if (value && typeof value === "object" && "id" in value) {
    const maybeId = (value as { id?: unknown }).id;
    if (isNonEmptyString(maybeId)) return maybeId.trim();
  }

  return null;
}

function checkoutSessionOrderIdMatches(
  session: Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>>,
  orderId: string
): boolean {
  const metadata = (session.metadata ?? {}) as Record<string, unknown>;

  const metadataOrderId =
    metadata.order_id ??
    metadata.orderId ??
    metadata.orderID ??
    metadata.order ??
    metadata.order_uuid ??
    null;

  const candidates = [
    typeof metadataOrderId === "string" ? metadataOrderId.trim() : null,
    typeof session.client_reference_id === "string"
      ? session.client_reference_id.trim()
      : null,
  ].filter(Boolean) as string[];

  if (candidates.length === 0) {
    return true;
  }

  return candidates.includes(orderId);
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing env (${name})`);
  }
  return value;
}

function getSupabaseUserClient(token: string): SupabaseClient {
  const supabaseUrl = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = getRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  return createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false },
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });
}

function getSupabaseAdminClient(): {
  supabase: SupabaseClient;
  supabaseUrl: string;
  serviceKey: string;
} {
  const supabaseUrl = getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey = getRequiredEnv("SUPABASE_SERVICE_ROLE_KEY");

  return {
    supabase: createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false },
    }),
    supabaseUrl,
    serviceKey,
  };
}

async function parseBody(req: NextRequest): Promise<Body> {
  try {
    return (await req.json()) as Body;
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function extractBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
}

function pickFoodCheckoutId(body: Body): string | null {
  const raw = body.foodCheckoutId ?? body.food_checkout_id ?? null;
  const id = String(raw ?? "").trim();
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

async function confirmFoodQuoteCheckoutPaid(params: {
  supabaseAdmin: SupabaseClient;
  userId: string;
  foodCheckoutId: string;
  sessionId?: string | null;
}) {
  const { data: intent, error: intentError } = await params.supabaseAdmin
    .from("food_checkout_intents")
    .select(
      "id,client_user_id,status,amount_cents,currency,stripe_checkout_session_id,stripe_payment_intent_id,order_id,expires_at",
    )
    .eq("id", params.foodCheckoutId)
    .maybeSingle();

  if (intentError) {
    return json({ ok: false, error: intentError.message }, 500);
  }
  if (!intent) {
    return json({ ok: false, error: "Food checkout not found" }, 404);
  }
  if (String(intent.client_user_id) !== params.userId) {
    return json({ ok: false, error: "Forbidden" }, 403);
  }

  if (intent.order_id) {
    return json({
      ok: true,
      already: true,
      already_paid: true,
      payment_status: "paid",
      db_status: "paid",
      order_id: String(intent.order_id),
      orderId: String(intent.order_id),
      food_checkout_id: params.foodCheckoutId,
      pay_then_create: true,
    });
  }

  const sessionId =
    String(params.sessionId ?? "").trim() ||
    String(intent.stripe_checkout_session_id ?? "").trim() ||
    null;

  if (!sessionId) {
    return json(
      {
        ok: false,
        error: "Stripe payment not confirmed yet",
        food_checkout_id: params.foodCheckoutId,
      },
      409,
    );
  }

  let session;
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });
  } catch (e: unknown) {
    return json(
      {
        ok: false,
        error: e instanceof Error ? e.message : "stripe_session_retrieve_failed",
        food_checkout_id: params.foodCheckoutId,
      },
      502,
    );
  }

  const paid =
    String(session.payment_status).toLowerCase() === "paid" ||
    String(session.status).toLowerCase() === "complete";
  if (!paid) {
    return json(
      {
        ok: false,
        error: "Stripe payment not confirmed yet",
        food_checkout_id: params.foodCheckoutId,
        payment_status: session.payment_status,
      },
      409,
    );
  }

  const paymentIntentId = paymentIntentIdFromUnknown(session.payment_intent);
  const result = await materializePaidFoodOrderFromQuoteCheckout({
    supabaseAdmin: params.supabaseAdmin,
    foodCheckoutId: params.foodCheckoutId,
    sessionId,
    paymentIntentId,
    expectedAmountCents: getStripeAmountFromCheckoutSession(session),
    source: "confirm-paid:food_quote_checkout",
  });

  if (result.ok === false) {
    const err = result.error;
    return json(
      {
        ok: false,
        error: err,
        food_checkout_id: params.foodCheckoutId,
      },
      err.includes("not_succeeded") || err === "amount_mismatch" ? 409 : 500,
    );
  }

  return json({
    ok: true,
    already: result.already_paid === true,
    already_paid: result.already_paid === true,
    payment_status: "paid",
    db_status: "paid",
    order_id: result.order_id,
    orderId: result.order_id,
    food_checkout_id: params.foodCheckoutId,
    pay_then_create: true,
    created: result.created === true,
  });
}

async function verifyOrderPaidState(opts: {
  supabaseUrl: string;
  serviceKey: string;
  orderId: string;
  expectedSessionId: string | null;
  expectedPaymentIntentId: string | null;
}): Promise<VerifyPaidStateResult> {
  const {
    supabaseUrl,
    serviceKey,
    orderId,
    expectedSessionId,
    expectedPaymentIntentId,
  } = opts;

  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("id, payment_status, stripe_session_id, stripe_payment_intent_id")
    .eq("id", orderId)
    .maybeSingle<VerifyOrderRow>();

  if (error) {
    return {
      ok: false,
      reason: "verify_lookup_failed",
      error,
      order: null,
    };
  }

  if (!data) {
    return {
      ok: false,
      reason: "verify_order_not_found",
      error: null,
      order: null,
    };
  }

  if (!isPaidStatus(data.payment_status)) {
    return {
      ok: false,
      reason: "verify_not_paid",
      error: null,
      order: data,
    };
  }

  if (
    expectedSessionId &&
    data.stripe_session_id &&
    data.stripe_session_id !== expectedSessionId
  ) {
    return {
      ok: false,
      reason: "verify_session_mismatch",
      error: null,
      order: data,
    };
  }

  if (
    expectedPaymentIntentId &&
    data.stripe_payment_intent_id &&
    data.stripe_payment_intent_id !== expectedPaymentIntentId
  ) {
    return {
      ok: false,
      reason: "verify_payment_intent_mismatch",
      error: null,
      order: data,
    };
  }

  return {
    ok: true,
    reason: "verified",
    error: null,
    order: data,
  };
}

export async function POST(req: NextRequest) {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      return json({ error: "Missing Authorization Bearer token" }, 401);
    }

    const supabaseUser = getSupabaseUserClient(token);
    const { supabase: supabaseAdmin, supabaseUrl, serviceKey } =
      getSupabaseAdminClient();

    const {
      data: userData,
      error: userErr,
    } = await supabaseUser.auth.getUser();

    const user = userData?.user;

    if (userErr || !user?.id) {
      return json({ error: "Invalid token" }, 401);
    }

    const body = await parseBody(req);

    const foodCheckoutId = pickFoodCheckoutId(body);
    if (foodCheckoutId) {
      return confirmFoodQuoteCheckoutPaid({
        supabaseAdmin,
        userId: user.id,
        foodCheckoutId,
        sessionId: body.sessionId ?? body.session_id ?? null,
      });
    }

    const orderId = String(body.order_id ?? body.orderId ?? "").trim();

    if (!orderId) {
      return json({ error: "Missing orderId" }, 400);
    }

    const { data: order, error: ordErr } = await supabaseAdmin
      .from("orders")
      .select(ORDER_CONFIRM_PAID_SELECT)
      .eq("id", orderId)
      .single<OrderRow>();

    if (ordErr || !order) {
      if (ordErr) {
        logSupabaseError("[confirm-paid] order lookup failed", ordErr, {
          order_id: orderId,
          user_id: user.id,
        });
      }

      return json({ error: "Order not found" }, 404);
    }

    const ownerId = order.client_user_id ?? order.created_by;

    if (!ownerId || ownerId !== user.id) {
      return json({ error: "Forbidden" }, 403);
    }

    const platformGate = await gateOrderPlatformFeature(
      supabaseAdmin,
      order,
      orderVerticalForPlatformGate(order.kind),
      "checkout"
    );
    if (platformGate.ok === false) {
      return json(platformGate.body, platformGate.status);
    }

    if (isPaidStatus(order.payment_status)) {
      return json({
        ok: true,
        orderId,
        message: "Order already marked as paid",
        db_status: "paid",
        via: "already_paid",
      });
    }

    const paymentIntentIdOnOrder = String(
      order.stripe_payment_intent_id ?? ""
    ).trim();

    if (!order.stripe_session_id) {
      if (!paymentIntentIdOnOrder) {
        return json(
          { error: "No stripe_session_id or stripe_payment_intent_id on order" },
          400
        );
      }

      const paymentIntent =
        await stripe.paymentIntents.retrieve(paymentIntentIdOnOrder);
      const piStatus = String(paymentIntent.status ?? "").toLowerCase();
      const metadata = (paymentIntent.metadata ?? {}) as Record<string, unknown>;
      const metadataOrderId = String(
        metadata.order_id ?? metadata.orderId ?? ""
      ).trim();

      if (metadataOrderId && metadataOrderId !== orderId) {
        return json(
          {
            error: "Payment intent does not belong to this order",
            orderId,
            stripe_payment_intent_id: paymentIntentIdOnOrder,
          },
          409
        );
      }

      if (piStatus !== "succeeded") {
        return json({
          ok: false,
          message: "Payment intent not succeeded yet",
          orderId,
          stripe_status: piStatus,
        });
      }

      const expectedCents = resolveOrderAmountCents(order);
      if (
        expectedCents != null &&
        Number.isFinite(paymentIntent.amount) &&
        paymentIntent.amount !== expectedCents
      ) {
        return json(
          {
            error: "Payment amount mismatch",
            orderId,
            expected_cents: expectedCents,
            actual_cents: paymentIntent.amount,
          },
          409
        );
      }

      const piExpectation = assertSettlementMatchesExpectation(
        evaluateStripeSettlement({ paymentIntent }),
        metadata,
        {
          userIds: [order.created_by, order.client_user_id],
          serviceType: "food",
          entityId: orderId,
          entityIdKeys: ["order_id", "orderId"],
        }
      );
      if (!piExpectation.ok) {
        return json(
          {
            ok: false,
            error: "payment_expectation_mismatch",
            orderId,
            field: piExpectation.field,
            reason: piExpectation.reason,
          },
          409
        );
      }

      const walletBridge = await bridgeStripeWalletFromPaidOrder(supabaseAdmin, {
        paymentIntentId: paymentIntentIdOnOrder,
        order,
        source: "confirm-paid:payment_intent",
      });
      if (walletBridge.ok === false) {
        logTechnicalError("[confirm-paid] wallet bridge failed (PI)", walletBridge.error, {
          order_id: orderId,
        });
        return json({ error: "wallet_ledger_bridge_failed" }, 500);
      }

      const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc(
        "mark_order_paid",
        {
          p_order_id: orderId,
          p_session_id: null,
          p_payment_intent_id: paymentIntentIdOnOrder,
        }
      );

      if (rpcErr) {
        logSupabaseError("[confirm-paid] mark_order_paid (PI) failed", rpcErr, {
          order_id: orderId,
          user_id: user.id,
          payment_intent_id: paymentIntentIdOnOrder,
        });

        return json(
          {
            error: toUserFacingError(
              rpcErr,
              "Le paiement n'a pas pu être confirmé. Réessayez dans quelques instants.",
            ),
          },
          500
        );
      }

      const verified = await verifyOrderPaidState({
        supabaseUrl,
        serviceKey,
        orderId,
        expectedSessionId: null,
        expectedPaymentIntentId: paymentIntentIdOnOrder,
      });

      if (!verified.ok) {
        console.error("[confirm-paid] PI verification failed after rpc", {
          order_id: orderId,
          reason: verified.reason,
          order: verified.order,
        });

        return json(
          {
            error: "Paid confirmation verification failed",
            orderId,
            reason: verified.reason,
          },
          500
        );
      }

      const commissions = await ensureOrderCommissionsReady(
        supabaseAdmin,
        orderId,
        "confirm-paid:payment_intent"
      );

      if (commissions.ok === false) {
        return json(
          {
            error: "order_commissions_refresh_failed",
            orderId,
            details: commissions.error,
          },
          503
        );
      }

      await completeFoodOrderAfterPayment(supabaseAdmin, {
        orderId,
        clientUserIds: [order.client_user_id, order.created_by, user.id],
        kind: order.kind,
        dispatchOrigin: req.nextUrl.origin,
      });

      const { enqueuePaymentSucceededAndProcessBatch } = await import(
        "@/lib/finance/financeEvents"
      );
      const finance = await enqueuePaymentSucceededAndProcessBatch(
        supabaseAdmin,
        {
          entityType: "order",
          entityId: orderId,
          vertical: "food",
          amountCents: resolveOrderAmountCents(order),
          currency: order.currency ?? "USD",
          countryCode: resolveOrderPlatformCountry(order),
          paymentIntentId: paymentIntentIdOnOrder,
        },
      );

      return json({
        ok: true,
        orderId,
        stripe_status: piStatus,
        via: "payment_intent",
        rpcData,
        finance_sync_pending: finance.ok === false,
        finance_error: finance.ok === false ? finance.error : undefined,
      });
    }

    const session = await stripe.checkout.sessions.retrieve(order.stripe_session_id);
    const stripePayStatus = String(session.payment_status ?? "").toLowerCase();

    if (!checkoutSessionOrderIdMatches(session, orderId)) {
      return json(
        {
          error: "Stripe session does not belong to this order",
          orderId,
          stripe_session_id: order.stripe_session_id,
        },
        409
      );
    }

    if (stripePayStatus !== "paid") {
      return json({
        ok: false,
        message: "Session not paid yet",
        stripe_status: stripePayStatus,
        orderId,
      });
    }

    const expectedCheckoutCents = resolveOrderAmountCents(order);
    const sessionAmountTotal =
      typeof session.amount_total === "number" ? session.amount_total : null;

    if (
      expectedCheckoutCents != null &&
      sessionAmountTotal != null &&
      sessionAmountTotal !== expectedCheckoutCents
    ) {
      return json(
        {
          error: "Checkout amount mismatch",
          orderId,
          expected_cents: expectedCheckoutCents,
          actual_cents: sessionAmountTotal,
        },
        409
      );
    }

    const paymentIntentId = paymentIntentIdFromUnknown(session.payment_intent);

    if (
      order.stripe_payment_intent_id &&
      paymentIntentId &&
      order.stripe_payment_intent_id !== paymentIntentId
    ) {
      return json(
        {
          error: "Payment intent mismatch",
          orderId,
          db_payment_intent_id: order.stripe_payment_intent_id,
          stripe_payment_intent_id: paymentIntentId,
        },
        409
      );
    }

    // Single source of truth: never mark paid on session.payment_status alone —
    // require the underlying PaymentIntent to have actually succeeded.
    const settled = await requirePaymentIntentSucceeded({
      paymentIntentId: paymentIntentId ?? order.stripe_payment_intent_id ?? null,
      sessionId: order.stripe_session_id,
      session,
    });

    if (!settled.ok) {
      return json({
        ok: false,
        message: "Payment not confirmed by Stripe yet",
        orderId,
        stripe_status: settled.reason,
      });
    }

    const sessionExpectation = assertSettlementMatchesExpectation(
      settled,
      settled.metadata,
      {
        userIds: [order.created_by, order.client_user_id],
        serviceType: "food",
        entityId: orderId,
        entityIdKeys: ["order_id", "orderId"],
      }
    );
    if (!sessionExpectation.ok) {
      return json(
        {
          ok: false,
          error: "payment_expectation_mismatch",
          orderId,
          field: sessionExpectation.field,
          reason: sessionExpectation.reason,
        },
        409
      );
    }

    if (paymentIntentId) {
      const walletBridge = await bridgeStripeWalletFromPaidOrder(supabaseAdmin, {
        paymentIntentId,
        order,
        source: "confirm-paid:checkout_session",
      });
      if (walletBridge.ok === false) {
        logTechnicalError("[confirm-paid] wallet bridge failed (checkout)", walletBridge.error, {
          order_id: orderId,
        });
        return json({ error: "wallet_ledger_bridge_failed" }, 500);
      }
    }

    const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc(
      "mark_order_paid",
      {
        p_order_id: orderId,
        p_session_id: order.stripe_session_id,
        p_payment_intent_id: paymentIntentId,
      }
    );

    if (rpcErr) {
      logSupabaseError("[confirm-paid] mark_order_paid failed", rpcErr, {
        order_id: orderId,
        user_id: user.id,
        stripe_session_id: order.stripe_session_id,
        payment_intent_id: paymentIntentId,
      });

      return json(
        {
          error: toUserFacingError(
            rpcErr,
            "Le paiement n'a pas pu être confirmé. Réessayez dans quelques instants.",
          ),
        },
        500
      );
    }

    const verified = await verifyOrderPaidState({
      supabaseUrl,
      serviceKey,
      orderId,
      expectedSessionId: order.stripe_session_id,
      expectedPaymentIntentId: paymentIntentId,
    });

    if (!verified.ok) {
      console.error("[confirm-paid] verification failed after rpc", {
        order_id: orderId,
        reason: verified.reason,
        order: verified.order,
      });

      return json(
        {
          error: "Paid confirmation verification failed",
          orderId,
          reason: verified.reason,
        },
        500
      );
    }

    const commissions = await ensureOrderCommissionsReady(
      supabaseAdmin,
      orderId,
      "confirm-paid:checkout_session"
    );

    if (commissions.ok === false) {
      return json(
        {
          error: "order_commissions_refresh_failed",
          orderId,
          details: commissions.error,
        },
        503
      );
    }

    await completeFoodOrderAfterPayment(supabaseAdmin, {
      orderId,
      clientUserIds: [order.client_user_id, order.created_by, user.id],
      kind: order.kind,
      dispatchOrigin: req.nextUrl.origin,
    });

    const { enqueuePaymentSucceededAndProcessBatch } = await import(
      "@/lib/finance/financeEvents"
    );
    const finance = await enqueuePaymentSucceededAndProcessBatch(
      supabaseAdmin,
      {
        entityType: "order",
        entityId: orderId,
        vertical: "food",
        amountCents: resolveOrderAmountCents(order),
        currency: order.currency ?? "USD",
        countryCode: resolveOrderPlatformCountry(order),
        paymentIntentId,
      },
    );

    return json({
      ok: true,
      orderId,
      stripe_status: stripePayStatus,
      via: "rpc_resync",
      rpcData,
      finance_sync_pending: finance.ok === false,
      finance_error: finance.ok === false ? finance.error : undefined,
    });
  } catch (e: unknown) {
    logTechnicalError("confirm-paid", e);
    return json(
      {
        error: "confirm_paid_failed",
        message: toUserFacingError(e, "Le paiement n'a pas pu être confirmé pour le moment. Réessayez."),
      },
      500,
    );
  }
}
