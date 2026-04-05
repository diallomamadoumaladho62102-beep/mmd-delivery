import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";
import {
  AdminAccessError,
  assertCanRetryPayout,
} from "@/lib/adminServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  session_id?: string;
  sessionId?: string;
};

type GenericErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

type OrderSyncRow = {
  id: string;
  status: string | null;
  payment_status: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
};

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

function logStripeSync(prefix: string, extra?: Record<string, unknown>) {
  console.error(prefix, extra ?? {});
}

async function parseBody(req: NextRequest): Promise<Body> {
  try {
    return (await req.json()) as Body;
  } catch {
    throw new Error("Invalid JSON body");
  }
}

async function authorizeRequest(req: NextRequest): Promise<string> {
  const adminSecret = process.env.STRIPE_SYNC_ADMIN_SECRET;
  const provided = req.headers.get("x-admin-secret");

  if (adminSecret && provided === adminSecret) {
    return "secret:stripe_sync_admin_secret";
  }

  const admin = await assertCanRetryPayout();
  return admin.userId;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function resolveOrderIdFromSession(
  session: Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>>
): string | null {
  const metadata = session.metadata ?? {};

  const fromMetadata =
    (typeof metadata.order_id === "string" && metadata.order_id.trim()) ||
    (typeof metadata.orderId === "string" && metadata.orderId.trim()) ||
    null;

  if (fromMetadata) {
    return fromMetadata;
  }

  if (
    typeof session.client_reference_id === "string" &&
    session.client_reference_id.trim()
  ) {
    return session.client_reference_id.trim();
  }

  return null;
}

function resolvePaymentIntentIdFromSession(
  session: Awaited<ReturnType<typeof stripe.checkout.sessions.retrieve>>
): string | null {
  if (
    typeof session.payment_intent === "string" &&
    session.payment_intent.trim()
  ) {
    return session.payment_intent.trim();
  }

  return null;
}

function normalizeSessionId(value: unknown): string {
  const sessionId = String(value ?? "").trim();

  if (!sessionId) {
    throw new Error("Missing session_id");
  }

  if (!/^cs_/.test(sessionId)) {
    throw new Error("Invalid session_id format");
  }

  return sessionId;
}

async function getOrderForSync(
  supabaseAdmin: SupabaseClient,
  orderId: string
): Promise<OrderSyncRow | null> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select(
      "id, status, payment_status, stripe_session_id, stripe_payment_intent_id"
    )
    .eq("id", orderId)
    .maybeSingle<OrderSyncRow>();

  if (error) {
    logSupabaseError("[sync-session] load order failed", error, {
      order_id: orderId,
    });
    throw new Error(error.message);
  }

  return data ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const actor = await authorizeRequest(req);
    const supabaseAdmin = getSupabaseAdmin();
    const body = await parseBody(req);

    const sessionId = normalizeSessionId(body.session_id ?? body.sessionId);

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    const paymentStatus = String(session.payment_status ?? "").toLowerCase();
    const sessionStatus = String(session.status ?? "").toLowerCase();

    const orderId = resolveOrderIdFromSession(session);

    if (!orderId) {
      return json(
        {
          error: "Cannot resolve order_id from session",
          session_id: sessionId,
        },
        422
      );
    }

    const paymentIntentId = resolvePaymentIntentIdFromSession(session);
    const existingOrder = await getOrderForSync(supabaseAdmin, orderId);

    if (!existingOrder) {
      return json(
        {
          error: "Order not found",
          order_id: orderId,
          session_id: sessionId,
        },
        404
      );
    }

    if (
      isNonEmptyString(existingOrder.stripe_session_id) &&
      existingOrder.stripe_session_id !== sessionId
    ) {
      return json(
        {
          error: "Session/order mismatch",
          order_id: orderId,
          session_id: sessionId,
          existing_session_id: existingOrder.stripe_session_id,
        },
        409
      );
    }

    if (
      isNonEmptyString(existingOrder.stripe_payment_intent_id) &&
      isNonEmptyString(paymentIntentId) &&
      existingOrder.stripe_payment_intent_id !== paymentIntentId
    ) {
      return json(
        {
          error: "Payment intent/order mismatch",
          order_id: orderId,
          session_id: sessionId,
          payment_intent_id: paymentIntentId,
          existing_payment_intent_id: existingOrder.stripe_payment_intent_id,
        },
        409
      );
    }

    if (paymentStatus === "paid") {
      const { data: rpcData, error: rpcErr } = await supabaseAdmin.rpc(
        "mark_order_paid",
        {
          p_order_id: orderId,
          p_session_id: sessionId,
          p_payment_intent_id: paymentIntentId,
        }
      );

      if (rpcErr) {
        logSupabaseError("[sync-session] mark_order_paid failed", rpcErr, {
          actor,
          order_id: orderId,
          session_id: sessionId,
          payment_intent_id: paymentIntentId,
        });

        return json({ error: rpcErr.message }, 500);
      }

      const finalOrder = await getOrderForSync(supabaseAdmin, orderId);

      return json({
        ok: true,
        action: "paid",
        actor,
        order_id: orderId,
        session_id: sessionId,
        payment_intent_id: paymentIntentId,
        payment_status: paymentStatus,
        session_status: sessionStatus,
        order_status: finalOrder?.status ?? null,
        order_payment_status: finalOrder?.payment_status ?? null,
        rpcData,
      });
    }

    const nowIso = new Date().toISOString();

    // Production-safe behavior:
    // - expired => cancel the order
    // - open / complete / anything else not paid => keep order recoverable as unpaid
    const shouldCancel = sessionStatus === "expired";

    const { error: updErr } = await supabaseAdmin
      .from("orders")
      .update({
        payment_status: "unpaid",
        ...(shouldCancel ? { status: "canceled" } : {}),
        updated_at: nowIso,
      })
      .eq("id", orderId)
      .neq("payment_status", "paid");

    if (updErr) {
      logSupabaseError("[sync-session] reset order failed", updErr, {
        actor,
        order_id: orderId,
        session_id: sessionId,
        payment_status: paymentStatus,
        session_status: sessionStatus,
      });

      return json({ error: updErr.message }, 500);
    }

    const finalOrder = await getOrderForSync(supabaseAdmin, orderId);

    if (!finalOrder) {
      logStripeSync("[sync-session] post-update order missing", {
        actor,
        order_id: orderId,
        session_id: sessionId,
      });

      return json(
        {
          error: "Order missing after sync update",
          order_id: orderId,
          session_id: sessionId,
        },
        500
      );
    }

    return json({
      ok: true,
      action: shouldCancel ? "canceled" : "unpaid",
      actor,
      order_id: orderId,
      session_id: sessionId,
      payment_intent_id: paymentIntentId,
      payment_status: paymentStatus,
      session_status: sessionStatus,
      order_status: finalOrder.status,
      order_payment_status: finalOrder.payment_status,
    });
  } catch (e: unknown) {
    const status = e instanceof AdminAccessError ? e.status : 500;

    return json({ error: getErrorMessage(e) }, status);
  }
}