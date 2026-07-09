import { NextRequest, NextResponse } from "next/server";
import {
  createClient,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";
import {
  isAmountVerificationFailure,
  verifyStripePaidMatchesDeliveryRequest,
} from "@/lib/verifyStripePaidAmount";
import { gateDeliveryRequestPlatformFeature } from "@/lib/platformRouteGuards";
import { bridgeStripeWalletFromPaidDeliveryRequest } from "@/lib/stripeInboundWalletBridge";
import { syncPaidDeliveryRequestOrder } from "@/lib/deliveryRequestService";
import { ensureOrderCommissionsReady } from "@/lib/refreshOrderCommissions";
import { scheduleDeliveryRequestDispatch } from "@/lib/scheduleDeliveryRequestDispatch";
import { notifyClientDeliveryRequestPaid } from "@/lib/clientPushNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  deliveryRequestId?: string;
  delivery_request_id?: string;
  session_id?: string;
  checkout_session_id?: string;
};

type DeliveryRequestRow = {
  id: string;
  created_by: string | null;
  client_user_id: string | null;
  payment_status: string | null;
  stripe_payment_intent_id: string | null;
  stripe_session_id: string | null;
  paid_at: string | null;
  updated_at?: string | null;
  total_cents: number | null;
  total: number | null;
  currency: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
};

type GenericErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

type StripePaidCheckResult = {
  paid: boolean;
  stripe_paid: boolean;
  payment_intent_id: string | null;
  session_id: string | null;
  session_payment_status?: string | null;
  session_status?: string | null;
};

const REQUEST_ID_MAX_LENGTH = 128;
const STRIPE_ID_MAX_LENGTH = 255;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;

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
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeRequestId(value: unknown): string {
  const raw = String(value ?? "").trim();

  if (!raw) return "";

  if (raw.length > REQUEST_ID_MAX_LENGTH) {
    throw new Error("Invalid delivery_request_id");
  }

  if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new Error("Invalid delivery_request_id");
  }

  return raw;
}

function normalizeStripeObjectId(value: unknown): string {
  const raw = String(value ?? "").trim();

  if (!raw) return "";

  if (raw.length > STRIPE_ID_MAX_LENGTH) {
    throw new Error("Invalid stripe object id");
  }

  if (!/^[A-Za-z0-9_]+$/.test(raw)) {
    throw new Error("Invalid stripe object id");
  }

  return raw;
}

function isPaidStatus(status: unknown): boolean {
  return String(status ?? "").trim().toLowerCase() === "paid";
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

function extractBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
}

function getSupabaseUserClient(token: string): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing env (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY)"
    );
  }

  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function getSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error(
      "Missing env (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)"
    );
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });
}

async function parseBody(req: NextRequest): Promise<Body> {
  const contentLengthHeader = req.headers.get("content-length");
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : 0;

  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_REQUEST_BODY_BYTES
  ) {
    throw new Error("Request body too large");
  }

  const raw = await req.text();

  if (raw.length > MAX_REQUEST_BODY_BYTES) {
    throw new Error("Request body too large");
  }

  if (!raw.trim()) {
    return {};
  }

  try {
    return JSON.parse(raw) as Body;
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function isOwnedByUser(request: DeliveryRequestRow, userId: string): boolean {
  return request.created_by === userId || request.client_user_id === userId;
}

function paymentIntentIdFromUnknown(value: unknown): string | null {
  if (isNonEmptyString(value)) return value.trim();

  if (value && typeof value === "object" && "id" in value) {
    const maybeId = (value as { id?: unknown }).id;
    if (isNonEmptyString(maybeId)) return maybeId.trim();
  }

  return null;
}

async function retrievePaymentIntentSafe(paymentIntentId: string) {
  try {
    return await stripe.paymentIntents.retrieve(paymentIntentId);
  } catch (e) {
    console.warn(
      "[mark-delivery-request-paid] paymentIntent retrieve failed:",
      getErrorMessage(e),
      { payment_intent_id: paymentIntentId }
    );
    return null;
  }
}

async function retrieveSessionSafe(sessionId: string) {
  try {
    return await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });
  } catch (e) {
    console.warn(
      "[mark-delivery-request-paid] session retrieve failed:",
      getErrorMessage(e),
      { session_id: sessionId }
    );
    return null;
  }
}

async function stripePaymentLooksPaid(params: {
  deliveryRequest: DeliveryRequestRow;
  requestedSessionId?: string | null;
}): Promise<StripePaidCheckResult> {
  const { deliveryRequest, requestedSessionId = null } = params;

  const dbPaymentIntentId = String(
    deliveryRequest.stripe_payment_intent_id ?? ""
  ).trim();
  const dbSessionId = String(deliveryRequest.stripe_session_id ?? "").trim();
  const candidateSessionId = String(requestedSessionId ?? "").trim() || dbSessionId;

  if (dbPaymentIntentId) {
    const pi = await retrievePaymentIntentSafe(dbPaymentIntentId);

    if (pi?.status === "succeeded") {
      return {
        paid: true,
        stripe_paid: true,
        payment_intent_id: paymentIntentIdFromUnknown(pi.id),
        session_id: candidateSessionId || null,
      };
    }
  }

  if (candidateSessionId) {
    const session = await retrieveSessionSafe(candidateSessionId);

    if (session) {
      const sessionPiId = paymentIntentIdFromUnknown(session.payment_intent);
      const sessionPaymentStatus = session.payment_status ?? null;
      const sessionStatus = session.status ?? null;

      if (sessionPaymentStatus === "paid") {
        if (sessionPiId) {
          const sessionPi = await retrievePaymentIntentSafe(sessionPiId);

          if (sessionPi?.status === "succeeded") {
            return {
              paid: true,
              stripe_paid: true,
              payment_intent_id: sessionPiId,
              session_id: session.id,
              session_payment_status: sessionPaymentStatus,
              session_status: sessionStatus,
            };
          }
        }

        // Do not treat checkout session "paid" as settled without a succeeded PaymentIntent.
        return {
          paid: false,
          stripe_paid: false,
          payment_intent_id: sessionPiId,
          session_id: session.id,
          session_payment_status: sessionPaymentStatus,
          session_status: sessionStatus,
        };
      }
    }
  }

  return {
    paid: false,
    stripe_paid: false,
    payment_intent_id: dbPaymentIntentId || null,
    session_id: candidateSessionId || null,
  };
}

async function getDeliveryRequestById(
  supabaseAdmin: SupabaseClient,
  requestId: string
): Promise<{ data: DeliveryRequestRow | null; error: PostgrestError | null }> {
  const { data, error } = await supabaseAdmin
    .from("delivery_requests")
    .select(
      "id, created_by, client_user_id, payment_status, stripe_payment_intent_id, stripe_session_id, paid_at, updated_at, total_cents, total, currency, pickup_lat, pickup_lng"
    )
    .eq("id", requestId)
    .single();

  return {
    data: (data ?? null) as DeliveryRequestRow | null,
    error: error as PostgrestError | null,
  };
}

export async function POST(req: NextRequest) {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      return json({ error: "Missing Authorization Bearer token" }, 401);
    }

    const supabaseUser = getSupabaseUserClient(token);
    const supabaseAdmin = getSupabaseAdminClient();

    const {
      data: { user },
      error: userErr,
    } = await supabaseUser.auth.getUser();

    if (userErr || !user?.id) {
      return json({ error: "Invalid token" }, 401);
    }

    const body = await parseBody(req);

    let requestedId = "";
    let requestedSessionId = "";

    try {
      requestedId = normalizeRequestId(
        body.delivery_request_id ?? body.deliveryRequestId
      );
    } catch {
      return json({ error: "Invalid delivery_request_id" }, 400);
    }

    try {
      requestedSessionId = normalizeStripeObjectId(
        body.session_id ?? body.checkout_session_id
      );
    } catch {
      return json({ error: "Invalid session_id" }, 400);
    }

    if (!requestedId) {
      return json({ error: "Missing delivery_request_id" }, 400);
    }

    const { data: deliveryRequest, error: reqErr } =
      await getDeliveryRequestById(supabaseAdmin, requestedId);

    if (reqErr) {
      logSupabaseError(
        "[mark-delivery-request-paid] request query failed",
        reqErr,
        {
          delivery_request_id: requestedId,
          user_id: user.id,
        }
      );

      const status = reqErr.code === "PGRST116" ? 404 : 500;

      return json(
        {
          error:
            status === 404
              ? "Delivery request not found"
              : "Delivery request query failed",
        },
        status
      );
    }

    if (!deliveryRequest) {
      return json({ error: "Delivery request not found" }, 404);
    }

    if (!isOwnedByUser(deliveryRequest, user.id)) {
      return json({ error: "Forbidden" }, 403);
    }

    const platformGate = await gateDeliveryRequestPlatformFeature(
      supabaseAdmin,
      deliveryRequest,
      "checkout"
    );
    if (platformGate.ok === false) {
      return json(platformGate.body, platformGate.status);
    }

    if (isPaidStatus(deliveryRequest.payment_status)) {
      const paymentIntentIdForBridge =
        deliveryRequest.stripe_payment_intent_id ??
        (
          await stripePaymentLooksPaid({
            deliveryRequest,
            requestedSessionId: requestedSessionId || null,
          })
        ).payment_intent_id;
      if (paymentIntentIdForBridge) {
        const walletBridge = await bridgeStripeWalletFromPaidDeliveryRequest(
          supabaseAdmin,
          {
            paymentIntentId: paymentIntentIdForBridge,
            deliveryRequest,
            source: "mark-delivery-request-paid:already_paid",
          }
        );
        if (walletBridge.ok === false) {
          return json({ error: "wallet_ledger_bridge_failed" }, 500);
        }
      }

      return json({
        ok: true,
        already: true,
        stripe_paid: true,
        delivery_request_id: deliveryRequest.id,
        stripe_payment_intent_id:
          deliveryRequest.stripe_payment_intent_id ?? null,
        stripe_session_id:
          requestedSessionId || deliveryRequest.stripe_session_id || null,
        payment_status: deliveryRequest.payment_status ?? "paid",
      });
    }

    const stripeCheck = await stripePaymentLooksPaid({
      deliveryRequest,
      requestedSessionId: requestedSessionId || null,
    });

    if (!stripeCheck.paid) {
      return json(
        {
          ok: false,
          stripe_paid: false,
          delivery_request_id: deliveryRequest.id,
          stripe_payment_intent_id:
            deliveryRequest.stripe_payment_intent_id ?? null,
          stripe_session_id:
            requestedSessionId || deliveryRequest.stripe_session_id || null,
          payment_status: deliveryRequest.payment_status ?? null,
          error: "Stripe payment not confirmed yet",
        },
        409
      );
    }

    const amountCheck = await verifyStripePaidMatchesDeliveryRequest(
      deliveryRequest,
      {
        paymentIntentId:
          stripeCheck.payment_intent_id ??
          deliveryRequest.stripe_payment_intent_id,
        sessionId:
          stripeCheck.session_id ??
          (requestedSessionId || deliveryRequest.stripe_session_id),
      }
    );

    if (isAmountVerificationFailure(amountCheck)) {
      return json(
        {
          ok: false,
          error: amountCheck.error,
          delivery_request_id: deliveryRequest.id,
          expected_cents: amountCheck.expected_cents ?? null,
          actual_cents: amountCheck.actual_cents ?? null,
          expected_currency: amountCheck.expected_currency ?? null,
          actual_currency: amountCheck.actual_currency ?? null,
          message: amountCheck.message ?? null,
        },
        amountCheck.error === "missing_expected_amount" ? 400 : 409
      );
    }

    const paymentIntentIdForBridge =
      amountCheck.payment_intent_id ??
      stripeCheck.payment_intent_id ??
      deliveryRequest.stripe_payment_intent_id;

    if (paymentIntentIdForBridge) {
      const walletBridge = await bridgeStripeWalletFromPaidDeliveryRequest(
        supabaseAdmin,
        {
          paymentIntentId: paymentIntentIdForBridge,
          deliveryRequest,
          source: "mark-delivery-request-paid",
        }
      );
      if (walletBridge.ok === false) {
        return json({ error: "wallet_ledger_bridge_failed" }, 500);
      }
    }

    const nowIso = new Date().toISOString();

    const updatePayload: Record<string, unknown> = {
      payment_status: "paid",
      paid_at: deliveryRequest.paid_at ?? nowIso,
      updated_at: nowIso,
      stripe_payment_intent_id:
        amountCheck.payment_intent_id ??
        stripeCheck.payment_intent_id ??
        deliveryRequest.stripe_payment_intent_id ??
        null,
      stripe_session_id:
        amountCheck.session_id ??
        stripeCheck.session_id ??
        requestedSessionId ??
        deliveryRequest.stripe_session_id ??
        null,
    };

    const { data: updatedRow, error: updErr } = await supabaseAdmin
      .from("delivery_requests")
      .update(updatePayload)
      .eq("id", deliveryRequest.id)
      .select(
        "id, payment_status, stripe_payment_intent_id, stripe_session_id, paid_at"
      )
      .single();

    if (updErr) {
      logSupabaseError(
        "[mark-delivery-request-paid] update paid failed",
        updErr,
        {
          delivery_request_id: deliveryRequest.id,
          updatePayload,
        }
      );

      return json({ error: "Failed to mark delivery request paid" }, 500);
    }

    if (!updatedRow || !isPaidStatus((updatedRow as DeliveryRequestRow).payment_status)) {
      return json({ error: "Payment update could not be verified after write" }, 500);
    }

    const clientId = String(
      deliveryRequest.client_user_id ?? deliveryRequest.created_by ?? user.id
    ).trim();

    const syncResult = await syncPaidDeliveryRequestOrder(
      supabaseAdmin,
      deliveryRequest.id,
      clientId
    );
    if (syncResult.ok === false) {
      console.error("[mark-delivery-request-paid] sync order failed", {
        delivery_request_id: deliveryRequest.id,
        error: syncResult.error,
      });
      return json({ error: syncResult.error }, 500);
    }

    const commissions = await ensureOrderCommissionsReady(
      supabaseAdmin,
      syncResult.orderId,
      "mark-delivery-request-paid"
    );
    if (commissions.ok === false) {
      console.error("[mark-delivery-request-paid] commissions failed", {
        delivery_request_id: deliveryRequest.id,
        order_id: syncResult.orderId,
        error: commissions.error,
      });
      return json({ error: commissions.error }, 500);
    }

    scheduleDeliveryRequestDispatch({
      origin: req.nextUrl.origin,
      deliveryRequestId: deliveryRequest.id,
    });

    await notifyClientDeliveryRequestPaid({
      supabaseAdmin,
      userIds: [
        deliveryRequest.client_user_id,
        deliveryRequest.created_by,
        user.id,
      ],
      deliveryRequestId: deliveryRequest.id,
    });

    return json({
      ok: true,
      stripe_paid: true,
      already: false,
      delivery_request_id: deliveryRequest.id,
      stripe_payment_intent_id:
        (updatedRow as DeliveryRequestRow).stripe_payment_intent_id ??
        stripeCheck.payment_intent_id ??
        null,
      stripe_session_id:
        (updatedRow as DeliveryRequestRow).stripe_session_id ??
        stripeCheck.session_id ??
        requestedSessionId ??
        null,
      payment_status: (updatedRow as DeliveryRequestRow).payment_status ?? "paid",
      paid_at:
        (updatedRow as DeliveryRequestRow).paid_at ??
        deliveryRequest.paid_at ??
        nowIso,
    });
  } catch (e: unknown) {
    const message = getErrorMessage(e);

    if (message === "Invalid JSON body") {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (message === "Request body too large") {
      return json({ error: "Request body too large" }, 413);
    }

    console.error("[mark-delivery-request-paid] fatal error", {
      message,
    });

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
