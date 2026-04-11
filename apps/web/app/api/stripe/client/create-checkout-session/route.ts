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
  created_by: string | null;
  client_user_id: string | null;
  client_id: string | null;
  user_id: string | null;
  total: number | null;
  grand_total: number | null;
  total_cents: number | null;
  currency: string | null;
  status: string | null;
  payment_status: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  expires_at: string | null;
};

type GenericErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

const ORDER_ID_MAX_LENGTH = 128;
const DEFAULT_TTL_MINUTES = 45;
const STRIPE_MIN_EXPIRES_AT_MINUTES = 31;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const ALLOWED_CURRENCIES = new Set(["usd", "eur", "gbp", "cad"]);
const ALLOWED_PAYABLE_STATUSES = new Set([
  "pending",
  "accepted",
  "prepared",
  "ready",
]);

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
        "X-Content-Type-Options": "nosniff",
      },
    }
  );
}

function normalizeOrderId(value: unknown): string {
  const raw = String(value ?? "").trim();

  if (!raw) return "";

  if (raw.length > ORDER_ID_MAX_LENGTH) {
    throw new Error("Invalid order_id");
  }

  if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new Error("Invalid order_id");
  }

  return raw;
}

function safeLowerCurrency(v: unknown): string {
  const c = String(v ?? "USD").trim().toLowerCase();
  if (!c) return "usd";
  return ALLOWED_CURRENCIES.has(c) ? c : "usd";
}

function isPrivateIpv4(hostname: string): boolean {
  return (
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}

/**
 * Production-safe URL normalization:
 * - https is always allowed
 * - http is allowed only for local/dev/private-network hosts
 */
function normalizeBaseUrl(v?: string | null): string {
  const s = String(v ?? "").trim();
  if (!s) return "";

  const withProtocol =
    s.startsWith("http://") || s.startsWith("https://") ? s : `https://${s}`;

  try {
    const parsed = new URL(withProtocol);
    const hostname = parsed.hostname;

    const allowHttp =
      parsed.protocol === "http:" &&
      (isLoopbackHost(hostname) || isPrivateIpv4(hostname));

    const allowHttps = parsed.protocol === "https:";

    if (!allowHttp && !allowHttps) {
      return "";
    }

    return parsed.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function normalizeAbsoluteCheckoutUrl(v?: string | null): string {
  const s = String(v ?? "").trim();
  if (!s) return "";

  try {
    const parsed = new URL(s);
    const hostname = parsed.hostname;

    const allowHttp =
      parsed.protocol === "http:" &&
      (isLoopbackHost(hostname) || isPrivateIpv4(hostname));

    const allowHttps = parsed.protocol === "https:";

    if (!allowHttp && !allowHttps) {
      return "";
    }

    return parsed.toString();
  } catch {
    return "";
  }
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

function toCentsFromDollars(amount: number): number {
  return Math.round(amount * 100);
}

function isPaidStatus(status: unknown): boolean {
  return String(status ?? "").trim().toLowerCase() === "paid";
}

function isProcessingStatus(status: unknown): boolean {
  return String(status ?? "").trim().toLowerCase() === "processing";
}

function isCanceledLikeStatus(status: unknown): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  return s === "canceled" || s === "cancelled" || s === "expired";
}

function isPayableOrderStatus(status: unknown): boolean {
  const s = String(status ?? "").trim().toLowerCase();
  return ALLOWED_PAYABLE_STATUSES.has(s);
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

function extractBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
}

function getOrderChargeAmountDollars(order: OrderRow): number {
  const grandTotal = Number(order.grand_total);
  if (Number.isFinite(grandTotal) && grandTotal > 0) {
    return grandTotal;
  }

  const totalCents = Number(order.total_cents);
  if (Number.isFinite(totalCents) && totalCents > 0) {
    return totalCents / 100;
  }

  const total = Number(order.total);
  if (Number.isFinite(total) && total > 0) {
    return total;
  }

  throw new Error(
    `Order ${order.id} has no frozen payable amount (grand_total / total_cents / total).`
  );
}

async function rollbackToUnpaid(
  supabaseAdmin: SupabaseClient,
  orderId: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("orders")
    .update({
      payment_status: "unpaid",
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .neq("payment_status", "paid");

  if (error) {
    logSupabaseError("[create-checkout-session] rollback unpaid failed", error, {
      order_id: orderId,
    });
  }
}

function buildPublicBaseUrl(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_WEB_BASE_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.APP_BASE_URL,
    process.env.VERCEL_URL
      ? `https://${String(process.env.VERCEL_URL).replace(/^https?:\/\//, "")}`
      : "",
  ];

  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) return normalized;
  }

  throw new Error(
    "Missing public site base URL. Set NEXT_PUBLIC_WEB_BASE_URL or NEXT_PUBLIC_SITE_URL."
  );
}

function buildCheckoutUrls(orderId: string) {
  const normalizedBase = buildPublicBaseUrl();

  const rawSuccessBase =
    process.env.STRIPE_CHECKOUT_SUCCESS_URL ||
    `${normalizedBase}/stripe/success`;

  const rawCancelBase =
    process.env.STRIPE_CHECKOUT_CANCEL_URL ||
    `${normalizedBase}/stripe/cancel`;

  const normalizedSuccessBase = normalizeAbsoluteCheckoutUrl(rawSuccessBase);
  const normalizedCancelBase = normalizeAbsoluteCheckoutUrl(rawCancelBase);

  if (!normalizedSuccessBase || !normalizedCancelBase) {
    throw new Error(
      "Invalid checkout return URLs. Check STRIPE_CHECKOUT_SUCCESS_URL / STRIPE_CHECKOUT_CANCEL_URL."
    );
  }

  const successUrl = `${normalizedSuccessBase.replace(/\/$/, "")}?orderId=${encodeURIComponent(orderId)}`;
  const cancelUrl = `${normalizedCancelBase.replace(/\/$/, "")}?orderId=${encodeURIComponent(orderId)}`;

  return { successUrl, cancelUrl };
}

function isOrderOwnedByUser(order: OrderRow, userId: string): boolean {
  return (
    order.created_by === userId ||
    order.client_user_id === userId ||
    order.client_id === userId ||
    order.user_id === userId
  );
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

    let requestedOrderId = "";
    try {
      requestedOrderId = normalizeOrderId(body.order_id ?? body.orderId);
    } catch {
      return json({ error: "Invalid order_id" }, 400);
    }

    if (!requestedOrderId) {
      return json({ error: "Missing order_id" }, 400);
    }

    const { data, error: ordErr } = await supabaseAdmin
      .from("orders")
      .select(
        "id, created_by, client_user_id, client_id, user_id, total, grand_total, total_cents, currency, status, payment_status, stripe_session_id, stripe_payment_intent_id, expires_at"
      )
      .eq("id", requestedOrderId)
      .single();

    const order = (data ?? null) as OrderRow | null;

    if (ordErr) {
      logSupabaseError("[create-checkout-session] order query failed", ordErr, {
        order_id: requestedOrderId,
        user_id: user.id,
      });

      const status =
        (ordErr as PostgrestError).code === "PGRST116" ? 404 : 500;

      return json(
        {
          error: status === 404 ? "Order not found" : "Order query failed",
        },
        status
      );
    }

    if (!order) {
      return json({ error: "Order not found" }, 404);
    }

    const orderId = String(order.id).trim();
    const orderStatus = String(order.status ?? "").trim().toLowerCase();
    const paymentStatus = String(order.payment_status ?? "unpaid")
      .trim()
      .toLowerCase();

    if (!isOrderOwnedByUser(order, user.id)) {
      return json({ error: "Forbidden" }, 403);
    }

    if (isCanceledLikeStatus(orderStatus)) {
      return json({ error: "Order is not payable" }, 409);
    }

    if (!isPayableOrderStatus(orderStatus)) {
      return json({ error: "Order status is not payable" }, 409);
    }

    if (isPaidStatus(paymentStatus)) {
      return json({ error: "Order already paid", order_id: orderId }, 409);
    }

    const nowMs = Date.now();
    const defaultExpiresAtMs = nowMs + DEFAULT_TTL_MINUTES * 60 * 1000;
    const minStripeExpiresAtMs =
      nowMs + STRIPE_MIN_EXPIRES_AT_MINUTES * 60 * 1000;

    const expiresAt =
      order.expires_at && Number.isFinite(new Date(order.expires_at).getTime())
        ? new Date(order.expires_at)
        : null;

    if (expiresAt && expiresAt.getTime() < nowMs) {
      const { error: expErr } = await supabaseAdmin
        .from("orders")
        .update({
          status: "canceled",
          payment_status: "unpaid",
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId)
        .neq("payment_status", "paid");

      if (expErr) {
        logSupabaseError(
          "[create-checkout-session] expire order update failed",
          expErr,
          { order_id: orderId }
        );
      }

      return json({ error: "Order expired" }, 410);
    }

    let effectiveExpiresAtMs = expiresAt?.getTime() ?? defaultExpiresAtMs;

    if (effectiveExpiresAtMs < minStripeExpiresAtMs) {
      effectiveExpiresAtMs = defaultExpiresAtMs;
    }

    if (!expiresAt || effectiveExpiresAtMs !== expiresAt.getTime()) {
      const expIso = new Date(effectiveExpiresAtMs).toISOString();

      const { error: expSetErr } = await supabaseAdmin
        .from("orders")
        .update({
          expires_at: expIso,
          updated_at: new Date().toISOString(),
        })
        .eq("id", orderId);

      if (expSetErr) {
        logSupabaseError(
          "[create-checkout-session] set expires_at failed",
          expSetErr,
          { order_id: orderId }
        );
      }
    }

    const existingSessionId = String(order.stripe_session_id ?? "").trim();

    if (existingSessionId) {
      try {
        const existingSession =
          await stripe.checkout.sessions.retrieve(existingSessionId);

        const existingSessionPi = paymentIntentIdFromUnknown(
          existingSession.payment_intent
        );

        const existingSessionMetadata =
          existingSession.metadata && typeof existingSession.metadata === "object"
            ? existingSession.metadata
            : {};

        const reusable =
          Boolean(existingSession.id) &&
          Boolean(existingSession.url) &&
          existingSession.status === "open";

        const belongsToSameOrder =
          String(existingSession.client_reference_id ?? "").trim() === orderId ||
          String(existingSessionMetadata.order_id ?? "").trim() === orderId ||
          String(existingSessionMetadata.orderId ?? "").trim() === orderId;

        const belongsToSameUser =
          !existingSessionMetadata.user_id ||
          String(existingSessionMetadata.user_id).trim() === String(user.id);

        const paymentIntentLooksConsistent =
          !order.stripe_payment_intent_id ||
          !existingSessionPi ||
          order.stripe_payment_intent_id === existingSessionPi;

        if (
          reusable &&
          belongsToSameOrder &&
          belongsToSameUser &&
          paymentIntentLooksConsistent
        ) {
          return json({
            url: existingSession.url,
            session_id: existingSession.id,
            id: existingSession.id,
            payment_intent_id: existingSessionPi,
            reused: true,
          });
        }
      } catch (e: unknown) {
        console.warn(
          "[create-checkout-session] retrieve existing session failed",
          getErrorMessage(e)
        );
      }
    }

    let chargeAmountDollars: number;
    try {
      chargeAmountDollars = getOrderChargeAmountDollars(order);
    } catch (e: unknown) {
      console.error("[create-checkout-session] invalid order amount source", {
        order_id: orderId,
        user_id: user.id,
        message: getErrorMessage(e),
      });
      return json({ error: "Invalid order amount" }, 400);
    }

    const amountCents =
      Number.isFinite(Number(order.total_cents)) && Number(order.total_cents) > 0
        ? Math.round(Number(order.total_cents))
        : toCentsFromDollars(chargeAmountDollars);

    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      logSupabaseError(
        "[create-checkout-session] invalid computed amount",
        new Error("Invalid amount"),
        {
          order_id: orderId,
          total_cents: order.total_cents,
          total: order.total,
          grand_total: order.grand_total,
        }
      );

      return json({ error: "Invalid order amount" }, 400);
    }

    let successUrl = "";
    let cancelUrl = "";

    try {
      const urls = buildCheckoutUrls(orderId);
      successUrl = urls.successUrl;
      cancelUrl = urls.cancelUrl;
    } catch (e: unknown) {
      console.error("[create-checkout-session] checkout URL build failed", {
        order_id: orderId,
        user_id: user.id,
        message: getErrorMessage(e),
      });

      return json({ error: "Checkout URLs are not configured correctly" }, 500);
    }

    const currency = safeLowerCurrency(order.currency ?? "USD");
    const idempotencyKey = `checkout_${orderId}_${user.id}_${amountCents}`;

    if (!isProcessingStatus(paymentStatus)) {
      const nowIso = new Date().toISOString();

      const { error: procErr } = await supabaseAdmin
        .from("orders")
        .update({
          payment_status: "processing",
          updated_at: nowIso,
        })
        .eq("id", orderId)
        .neq("payment_status", "paid");

      if (procErr) {
        logSupabaseError(
          "[create-checkout-session] set processing failed",
          procErr,
          { order_id: orderId }
        );

        return json({ error: "Failed to set order processing" }, 500);
      }
    }

    let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;

    try {
      session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          client_reference_id: orderId,
          expires_at: Math.floor(effectiveExpiresAtMs / 1000),
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency,
                unit_amount: amountCents,
                product_data: {
                  name: `MMD Order ${orderId.slice(0, 8)}`,
                  description: `Order payment • ${(amountCents / 100).toFixed(
                    2
                  )} ${currency.toUpperCase()}`,
                },
              },
            },
          ],
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            order_id: orderId,
            orderId: orderId,
            user_id: String(user.id),
            amount_cents: String(amountCents),
            amount_dollars: (amountCents / 100).toFixed(2),
            source_route: "/api/stripe/client/create-checkout-session",
          },
          payment_intent_data: {
            metadata: {
              order_id: orderId,
              orderId: orderId,
              user_id: String(user.id),
              amount_cents: String(amountCents),
              amount_dollars: (amountCents / 100).toFixed(2),
              source_route: "/api/stripe/client/create-checkout-session",
            },
          },
        },
        { idempotencyKey }
      );
    } catch (e: unknown) {
      await rollbackToUnpaid(supabaseAdmin, orderId);

      console.error("[create-checkout-session] stripe create failed", {
        order_id: orderId,
        user_id: user.id,
        message: getErrorMessage(e),
      });

      return json({ error: "Stripe session create failed" }, 500);
    }

    const paymentIntentId = paymentIntentIdFromUnknown(session.payment_intent);

    const { error: saveErr } = await supabaseAdmin
      .from("orders")
      .update({
        stripe_session_id: session.id,
        stripe_payment_intent_id: paymentIntentId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId)
      .neq("payment_status", "paid");

    if (saveErr) {
      logSupabaseError(
        "[create-checkout-session] save stripe refs failed",
        saveErr,
        {
          order_id: orderId,
          session_id: session.id,
          payment_intent_id: paymentIntentId,
        }
      );

      await rollbackToUnpaid(supabaseAdmin, orderId);

      return json(
        { error: "Failed to persist Stripe session to order" },
        500
      );
    }

    return json({
      url: session.url,
      session_id: session.id,
      id: session.id,
      payment_intent_id: paymentIntentId,
      amount_cents: amountCents,
      amount_dollars: amountCents / 100,
      expires_at: new Date(effectiveExpiresAtMs).toISOString(),
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

    console.error("[create-checkout-session] fatal error", {
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
