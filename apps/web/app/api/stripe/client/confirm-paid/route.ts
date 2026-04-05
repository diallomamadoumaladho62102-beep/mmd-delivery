import { NextRequest, NextResponse } from "next/server";
import {
  createClient,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  orderId?: string;
  order_id?: string;
};

type OrderRow = {
  id: string;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  payment_status: string | null;
  client_user_id: string | null;
  created_by: string | null;
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
    const orderId = String(body.order_id ?? body.orderId ?? "").trim();

    if (!orderId) {
      return json({ error: "Missing orderId" }, 400);
    }

    const { data: order, error: ordErr } = await supabaseAdmin
      .from("orders")
      .select(
        "id, stripe_session_id, stripe_payment_intent_id, payment_status, client_user_id, created_by"
      )
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

    if (isPaidStatus(order.payment_status)) {
      return json({
        ok: true,
        orderId,
        message: "Order already marked as paid",
        db_status: "paid",
        via: "already_paid",
      });
    }

    if (!order.stripe_session_id) {
      return json({ error: "No stripe_session_id on order" }, 400);
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
          error: "Failed to confirm paid status",
          details: rpcErr.message,
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

    return json({
      ok: true,
      orderId,
      stripe_status: stripePayStatus,
      via: "rpc_resync",
      rpcData,
    });
  } catch (e: unknown) {
    return json({ error: getErrorMessage(e) }, 500);
  }
}