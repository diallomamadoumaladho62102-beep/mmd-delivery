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
  deliveryRequestId?: string;
  delivery_request_id?: string;
};

type DeliveryRequestRow = {
  id: string;
  created_by: string | null;
  client_user_id: string | null;
  payment_status: string | null;
  stripe_payment_intent_id: string | null;
  stripe_session_id: string | null;
  paid_at: string | null;
};

type GenericErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

type StripeCheckResult = {
  paid: boolean;
  stripe_paid: boolean;
  payment_intent_id: string | null;
  source:
    | "payment_intent"
    | "checkout_session"
    | "checkout_session_complete"
    | "none";
};

const REQUEST_ID_MAX_LENGTH = 128;
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function safeLower(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function isPaidStatus(status: unknown): boolean {
  return safeLower(status) === "paid";
}

function isStripePaymentIntentPaid(status: unknown): boolean {
  return safeLower(status) === "succeeded";
}

function isStripeCheckoutSessionPaid(paymentStatus: unknown): boolean {
  return safeLower(paymentStatus) === "paid";
}

function isStripeCheckoutSessionComplete(status: unknown): boolean {
  return safeLower(status) === "complete";
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

async function stripePaymentLooksPaid(
  deliveryRequest: DeliveryRequestRow
): Promise<StripeCheckResult> {
  const paymentIntentId = String(
    deliveryRequest.stripe_payment_intent_id ?? ""
  ).trim();
  const sessionId = String(deliveryRequest.stripe_session_id ?? "").trim();

  if (paymentIntentId) {
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

      if (isStripePaymentIntentPaid(pi.status)) {
        return {
          paid: true,
          stripe_paid: true,
          payment_intent_id: paymentIntentIdFromUnknown(pi.id) ?? paymentIntentId,
          source: "payment_intent",
        };
      }

      console.log("[confirm-delivery-request-paid] paymentIntent not paid", {
        delivery_request_id: deliveryRequest.id,
        payment_intent_id: paymentIntentId,
        payment_intent_status: pi.status,
      });
    } catch (e) {
      console.warn(
        "[confirm-delivery-request-paid] paymentIntent retrieve failed:",
        getErrorMessage(e)
      );
    }
  }

  if (sessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["payment_intent"],
      });

      const sessionPiId =
        paymentIntentIdFromUnknown(session.payment_intent) ?? paymentIntentId;

      if (isStripeCheckoutSessionPaid(session.payment_status)) {
        return {
          paid: true,
          stripe_paid: true,
          payment_intent_id: sessionPiId,
          source: "checkout_session",
        };
      }

      if (isStripeCheckoutSessionComplete(session.status)) {
        return {
          paid: true,
          stripe_paid: true,
          payment_intent_id: sessionPiId,
          source: "checkout_session_complete",
        };
      }

      console.log("[confirm-delivery-request-paid] checkout session not paid", {
        delivery_request_id: deliveryRequest.id,
        stripe_session_id: sessionId,
        session_payment_status: session.payment_status,
        session_status: session.status,
        session_payment_intent_id: sessionPiId,
      });
    } catch (e) {
      console.warn(
        "[confirm-delivery-request-paid] session retrieve failed:",
        getErrorMessage(e)
      );
    }
  }

  return {
    paid: false,
    stripe_paid: false,
    payment_intent_id: paymentIntentId || null,
    source: "none",
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
    try {
      requestedId = normalizeRequestId(
        body.delivery_request_id ?? body.deliveryRequestId
      );
    } catch {
      return json({ error: "Invalid delivery_request_id" }, 400);
    }

    if (!requestedId) {
      return json({ error: "Missing delivery_request_id" }, 400);
    }

    const { data, error: reqErr } = await supabaseAdmin
      .from("delivery_requests")
      .select(
        "id, created_by, client_user_id, payment_status, stripe_payment_intent_id, stripe_session_id, paid_at"
      )
      .eq("id", requestedId)
      .single();

    const deliveryRequest = (data ?? null) as DeliveryRequestRow | null;

    if (reqErr) {
      logSupabaseError(
        "[confirm-delivery-request-paid] request query failed",
        reqErr,
        {
          delivery_request_id: requestedId,
          user_id: user.id,
        }
      );

      const status =
        (reqErr as PostgrestError).code === "PGRST116" ? 404 : 500;

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

    if (isPaidStatus(deliveryRequest.payment_status)) {
      return json({
        ok: true,
        already: true,
        stripe_paid: true,
        delivery_request_id: deliveryRequest.id,
        payment_status: "paid",
        stripe_payment_intent_id: deliveryRequest.stripe_payment_intent_id,
        stripe_session_id: deliveryRequest.stripe_session_id,
        paid_at: deliveryRequest.paid_at,
      });
    }

    const stripeCheck = await stripePaymentLooksPaid(deliveryRequest);

    if (!stripeCheck.paid) {
      return json(
        {
          ok: false,
          stripe_paid: false,
          delivery_request_id: deliveryRequest.id,
          error: "Stripe payment not confirmed yet",
          payment_status: deliveryRequest.payment_status,
          stripe_payment_intent_id: deliveryRequest.stripe_payment_intent_id,
          stripe_session_id: deliveryRequest.stripe_session_id,
        },
        409
      );
    }

    const nowIso = new Date().toISOString();

    const { data: updatedRow, error: updErr } = await supabaseAdmin
      .from("delivery_requests")
      .update({
        payment_status: "paid",
        paid_at: deliveryRequest.paid_at ?? nowIso,
        stripe_payment_intent_id:
          stripeCheck.payment_intent_id ??
          deliveryRequest.stripe_payment_intent_id ??
          null,
        updated_at: nowIso,
      })
      .eq("id", deliveryRequest.id)
      .select(
        "id, payment_status, stripe_payment_intent_id, stripe_session_id, paid_at"
      )
      .single();

    if (updErr) {
      logSupabaseError(
        "[confirm-delivery-request-paid] update paid failed",
        updErr,
        {
          delivery_request_id: deliveryRequest.id,
          stripe_check_source: stripeCheck.source,
          stripe_payment_intent_id: stripeCheck.payment_intent_id,
        }
      );

      return json({ error: "Failed to mark delivery request paid" }, 500);
    }

    if (!updatedRow || !isPaidStatus((updatedRow as { payment_status?: unknown }).payment_status)) {
      console.error("[confirm-delivery-request-paid] update returned unexpected row", {
        delivery_request_id: deliveryRequest.id,
        updated_row: updatedRow ?? null,
        stripe_check_source: stripeCheck.source,
      });

      return json(
        { error: "Payment update could not be verified after write" },
        500
      );
    }

    return json({
      ok: true,
      stripe_paid: true,
      already: false,
      delivery_request_id: deliveryRequest.id,
      payment_status: (updatedRow as { payment_status?: string | null }).payment_status ?? "paid",
      stripe_payment_intent_id:
        (updatedRow as { stripe_payment_intent_id?: string | null }).stripe_payment_intent_id ??
        stripeCheck.payment_intent_id ??
        null,
      stripe_session_id:
        (updatedRow as { stripe_session_id?: string | null }).stripe_session_id ??
        deliveryRequest.stripe_session_id,
      paid_at:
        (updatedRow as { paid_at?: string | null }).paid_at ??
        deliveryRequest.paid_at ??
        nowIso,
      stripe_check_source: stripeCheck.source,
    });
  } catch (e: unknown) {
    const message = getErrorMessage(e);

    if (message === "Invalid JSON body") {
      return json({ error: "Invalid JSON body" }, 400);
    }

    if (message === "Request body too large") {
      return json({ error: "Request body too large" }, 413);
    }

    console.error("[confirm-delivery-request-paid] fatal error", {
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