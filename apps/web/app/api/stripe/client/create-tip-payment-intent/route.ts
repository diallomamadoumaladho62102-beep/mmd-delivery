import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";
import { PAYMENT_METADATA_SCHEMA_VERSION } from "@/lib/requirePaymentIntentSucceeded";
import {
  assertFoodCheckoutCurrencyAllowed,
  foodStripeUnitAmount,
  safeFoodCheckoutCurrency,
} from "@/lib/foodCurrencyGuard";
import { TIP_MODEL } from "@/lib/finance/tipMoneyArchitecture";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  orderId?: string;
  order_id?: string;
};

type OrderRow = {
  id: string;
  created_by: string | null;
  client_user_id: string | null;
  client_id: string | null;
  user_id: string | null;
  status: string | null;
  currency: string | null;
  tip_cents: number | null;
  tip_paid_out: boolean | null;
  tip_transfer_id: string | null;
  tip_payment_intent_id: string | null;
};

type GenericErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

const ORDER_ID_MAX_LENGTH = 128;
const MAX_REQUEST_BODY_BYTES = 4 * 1024;

function asErrorLike(value: unknown): GenericErrorLike | null {
  if (!value || typeof value !== "object") return null;
  return value as GenericErrorLike;
}

function getErrorMessage(value: unknown): string {
  if (value instanceof Error && value.message) return value.message;
  const err = asErrorLike(value);
  if (typeof err?.message === "string" && err.message.trim()) return err.message;
  return "Unknown error";
}

function getErrorCode(value: unknown): string | null {
  const err = asErrorLike(value);
  return typeof err?.code === "string" ? err.code : null;
}

function logSupabaseError(
  prefix: string,
  err: unknown,
  extra?: Record<string, unknown>
) {
  console.error(prefix, {
    code: getErrorCode(err),
    message: getErrorMessage(err),
    ...extra,
  });
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
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

function normalizeOrderId(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (raw.length > ORDER_ID_MAX_LENGTH) throw new Error("Invalid order_id");
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error("Invalid order_id");
  return raw;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getSupabaseUserClient(token: string): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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
  const supabaseServiceKey =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

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

  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
    throw new Error("Request body too large");
  }

  const raw = await req.text();
  if (raw.length > MAX_REQUEST_BODY_BYTES) {
    throw new Error("Request body too large");
  }
  if (!raw.trim()) return {};

  try {
    return JSON.parse(raw) as Body;
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function extractBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
}

function isOrderOwnedByUser(order: OrderRow, userId: string): boolean {
  return (
    order.created_by === userId ||
    order.client_user_id === userId ||
    order.client_id === userId ||
    order.user_id === userId
  );
}

function paymentIntentIdFromUnknown(value: unknown): string | null {
  if (isNonEmptyString(value)) return value.trim();
  if (value && typeof value === "object" && "id" in value) {
    const maybeId = (value as { id?: unknown }).id;
    if (isNonEmptyString(maybeId)) return maybeId.trim();
  }
  return null;
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

    let orderId = "";
    try {
      orderId = normalizeOrderId(body.order_id ?? body.orderId);
    } catch {
      return json({ error: "Invalid order_id" }, 400);
    }

    if (!orderId) {
      return json({ error: "Missing order_id" }, 400);
    }

    const { data, error: ordErr } = await supabaseAdmin
      .from("orders")
      .select(
        "id, created_by, client_user_id, client_id, user_id, status, currency, tip_cents, tip_paid_out, tip_transfer_id, tip_payment_intent_id"
      )
      .eq("id", orderId)
      .maybeSingle<OrderRow>();

    if (ordErr) {
      logSupabaseError("[create-tip-payment-intent] order query failed", ordErr, {
        order_id: orderId,
        user_id: user.id,
      });
      return json({ error: "Order query failed" }, 500);
    }

    if (!data) {
      return json({ error: "Order not found" }, 404);
    }

    const order = data;

    if (!isOrderOwnedByUser(order, user.id)) {
      return json({ error: "Forbidden" }, 403);
    }

    if (String(order.status ?? "").trim().toLowerCase() !== "delivered") {
      return json(
        { error: "Tips can only be paid on a delivered order" },
        409
      );
    }

    const tipCents = Math.max(0, Math.round(Number(order.tip_cents ?? 0)));
    if (tipCents <= 0) {
      return json({ error: "Order has no tip amount set" }, 400);
    }

    if (order.tip_paid_out === true) {
      return json(
        {
          error: "tip_already_transferred",
          order_id: orderId,
        },
        409
      );
    }

    const currencyGuard = assertFoodCheckoutCurrencyAllowed(order.currency);
    if (currencyGuard.ok === false) {
      return json(
        {
          ok: false,
          error: currencyGuard.error,
          message: currencyGuard.message,
          currency: currencyGuard.currency,
        },
        400
      );
    }

    const existingPiId = String(order.tip_payment_intent_id ?? "").trim();

    if (existingPiId) {
      try {
        const existingPi = await stripe.paymentIntents.retrieve(existingPiId);
        const piStatus = String(existingPi.status ?? "").toLowerCase();

        if (piStatus === "succeeded") {
          return json(
            {
              error: "tip_payment_already_succeeded",
              order_id: orderId,
              payment_intent_id: existingPiId,
            },
            409
          );
        }

        if (
          piStatus === "processing" ||
          piStatus === "requires_capture" ||
          piStatus === "requires_confirmation"
        ) {
          return json(
            {
              error: "tip_payment_intent_in_progress",
              order_id: orderId,
              payment_intent_id: existingPiId,
              stripe_status: piStatus,
            },
            409
          );
        }

        if (
          piStatus === "requires_payment_method" ||
          piStatus === "requires_action"
        ) {
          // Same amount already requested and still payable — hand the client
          // secret back instead of minting a duplicate PaymentIntent.
          if (Number(existingPi.amount) === tipCents) {
            return json({
              client_secret: existingPi.client_secret,
              payment_intent_id: existingPi.id,
              order_id: orderId,
              amount_cents: tipCents,
              currency: currencyGuard.currency.toLowerCase(),
              reused: true,
            });
          }
        }
      } catch (e: unknown) {
        console.warn(
          "[create-tip-payment-intent] existing PI retrieve failed",
          getErrorMessage(e),
          { order_id: orderId, payment_intent_id: existingPiId }
        );
      }
    }

    const currency = safeFoodCheckoutCurrency(order.currency ?? "USD");
    const unitAmount = foodStripeUnitAmount(currency, tipCents);
    const idempotencyKey = `tip_pi_${orderId}_${user.id}_${tipCents}`;

    let paymentIntent: Awaited<ReturnType<typeof stripe.paymentIntents.create>>;

    try {
      paymentIntent = await stripe.paymentIntents.create(
        {
          amount: unitAmount,
          currency,
          automatic_payment_methods: { enabled: true },
          metadata: {
            metadata_schema_version: PAYMENT_METADATA_SCHEMA_VERSION,
            service_type: "food",
            module: "food",
            kind: TIP_MODEL.paymentIntentKind,
            order_id: orderId,
            orderId: orderId,
            user_id: String(user.id),
            tip_cents: String(tipCents),
            source_route: "/api/stripe/client/create-tip-payment-intent",
          },
        },
        { idempotencyKey }
      );
    } catch (e: unknown) {
      const message = getErrorMessage(e);
      console.error("[create-tip-payment-intent] stripe create failed", {
        order_id: orderId,
        user_id: user.id,
        message,
      });
      return json(
        { error: "Stripe payment intent create failed", detail: message.slice(0, 180) },
        500
      );
    }

    const paymentIntentId = paymentIntentIdFromUnknown(paymentIntent.id);

    const { error: saveErr } = await supabaseAdmin
      .from("orders")
      .update({
        tip_payment_intent_id: paymentIntentId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .eq("tip_paid_out", false)
      .is("tip_payment_intent_id", null);

    if (saveErr) {
      logSupabaseError(
        "[create-tip-payment-intent] save payment_intent_id failed",
        saveErr,
        { order_id: orderId, payment_intent_id: paymentIntentId }
      );
      return json(
        { error: "Failed to persist Stripe payment intent to order" },
        500
      );
    }

    return json({
      client_secret: paymentIntent.client_secret,
      payment_intent_id: paymentIntent.id,
      order_id: orderId,
      amount_cents: tipCents,
      currency,
      reused: false,
    });
  } catch (e: unknown) {
    const message = getErrorMessage(e);

    if (message === "Invalid JSON body") {
      return json({ error: "Invalid JSON body" }, 400);
    }
    if (message === "Request body too large") {
      return json({ error: "Request body too large" }, 413);
    }

    console.error("[create-tip-payment-intent] fatal error", { message });
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
