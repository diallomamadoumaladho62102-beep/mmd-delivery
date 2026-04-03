// apps/web/src/app/api/stripe/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  createClient,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { stripe, webhookSecret } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type OrderRow = {
  id: string;
  payment_status: string | null;
  total: number | null;
  grand_total: number | null;
  total_cents: number | null;
  currency: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
};

type MinimalOrderForAmount = Pick<
  OrderRow,
  "total" | "grand_total" | "total_cents" | "currency"
>;

type OrderLookupResult = {
  order: OrderRow | null;
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

type GenericErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024; // 1 MB
const HANDLED_EVENT_TYPES = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
  "payment_intent.succeeded",
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
      "Pragma": "no-cache",
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
        "Pragma": "no-cache",
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
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

function toPositiveNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function resolveOrderAmountCents(order: MinimalOrderForAmount): number | null {
  const totalCents = toPositiveNumber(order.total_cents);
  if (totalCents != null) return Math.round(totalCents);

  const total = toPositiveNumber(order.total);
  if (total != null) return Math.round(total * 100);

  const grandTotal = toPositiveNumber(order.grand_total);
  if (grandTotal != null) return Math.round(grandTotal * 100);

  return null;
}

function normalizeCurrency(value: unknown): string | null {
  const raw = String(value ?? "").trim().toLowerCase();
  return raw ? raw : null;
}

async function loadOrderForPaymentCheck(
  supabaseAdmin: SupabaseClient,
  orderId: string
): Promise<OrderLookupResult> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(
      "id, payment_status, total, grand_total, total_cents, currency, stripe_session_id, stripe_payment_intent_id"
    )
    .eq("id", orderId)
    .maybeSingle<OrderRow>();

  return {
    order: data ?? null,
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

async function persistStripeEvent(opts: {
  supabaseAdmin: SupabaseClient;
  event: Stripe.Event;
}): Promise<{ inserted: boolean; duplicate: boolean }> {
  const { supabaseAdmin, event } = opts;

  try {
    const { error } = await supabaseAdmin.from("stripe_events").insert({
      event_id: event.id,
      created_at: new Date().toISOString(),
    });

    if (!error) {
      console.log("✅ WEBHOOK: stripe_events saved", {
        event_id: event.id,
        type: event.type,
      });
      return { inserted: true, duplicate: false };
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
        event_id: event.id,
        type: event.type,
        code,
        message: getErrorMessage(error),
      });
      return { inserted: false, duplicate: true };
    }

    console.log("⚠️ WEBHOOK: could not insert stripe_events row", {
      code,
      message: getErrorMessage(error),
      details: getErrorDetails(error),
      hint: getErrorHint(error),
      event_id: event.id,
      type: event.type,
    });

    return { inserted: false, duplicate: false };
  } catch (e: unknown) {
    console.log("⚠️ WEBHOOK: stripe_events insert crashed", getErrorMessage(e));
    return { inserted: false, duplicate: false };
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

async function handleCheckoutCompletedLikeEvent(
  supabaseAdmin: SupabaseClient,
  event: Stripe.Event
) {
  const session = event.data.object as Stripe.Checkout.Session;

  const orderId =
    pickOrderIdFromMetadata(
      session.metadata as Record<string, unknown> | null
    ) ||
    (session.client_reference_id
      ? String(session.client_reference_id).trim()
      : null);

  const paymentIntentId = paymentIntentIdFromUnknown(session.payment_intent);
  const sessionId = normalizeStringOrNull(session.id);
  const sessionAmountTotal = getStripeAmountTotalFromSession(session);
  const sessionCurrency = normalizeCurrency(session.currency);

  console.log(`✅ WEBHOOK ${event.type}`, {
    sessionId,
    orderId,
    paymentIntentId,
    amount_total: session.amount_total,
    currency: session.currency,
    payment_status: session.payment_status,
    client_reference_id: session.client_reference_id,
    metadata: session.metadata,
  });

  if (!orderId) {
    return json({
      received: true,
      ignored: "missing orderId/order_id",
      type: event.type,
    });
  }

  if (!isCheckoutSessionActuallyPaid(session)) {
    console.log("ℹ️ WEBHOOK: checkout session not paid yet, ignored", {
      type: event.type,
      orderId,
      sessionId,
      payment_status: session.payment_status,
    });

    return json({
      received: true,
      ok: true,
      order_id: orderId,
      type: event.type,
      ignored: "session_not_paid",
      payment_status: session.payment_status,
    });
  }

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
    return json({ received: true, ok: false, error: "order_lookup_failed" }, 500);
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
    return json({
      received: true,
      ok: true,
      order_id: orderId,
      via: "already_paid",
      type: event.type,
    });
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

async function handlePaymentIntentSucceeded(
  supabaseAdmin: SupabaseClient,
  event: Stripe.Event
) {
  const pi = event.data.object as Stripe.PaymentIntent;

  const orderIdFromMd = pickOrderIdFromMetadata(
    pi.metadata as Record<string, unknown> | null
  );
  const paymentIntentId = pi.id;
  const piAmount = getStripeAmountFromPaymentIntent(pi);
  const piCurrency = normalizeCurrency(pi.currency);

  console.log("✅ WEBHOOK payment_intent.succeeded", {
    paymentIntentId,
    orderIdFromMd,
    metadata: pi.metadata,
    amount: pi.amount,
    currency: pi.currency,
    status: pi.status,
  });

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

  if (!orderId) {
    console.log("⚠️ WEBHOOK PI succeeded ignored: cannot resolve orderId", {
      paymentIntentId,
    });
    return json({
      received: true,
      ignored: "cannot_resolve_order_id",
      type: event.type,
    });
  }

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
    return json({ received: true, ok: false, error: "order_lookup_failed" }, 500);
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
    return json({
      received: true,
      ok: true,
      order_id: orderId,
      via: "already_paid",
      type: event.type,
    });
  }

  const result = await markOrderPaidRobustly({
    supabaseAdmin,
    orderId,
    sessionId: null,
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
          "Pragma": "no-cache",
          "X-Content-Type-Options": "nosniff",
        },
      });
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
      return json({
        received: true,
        duplicate: true,
        type: event.type,
        event_id: event.id,
      });
    }

    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      return await handleCheckoutCompletedLikeEvent(supabaseAdmin, event);
    }

    if (event.type === "payment_intent.succeeded") {
      return await handlePaymentIntentSucceeded(supabaseAdmin, event);
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