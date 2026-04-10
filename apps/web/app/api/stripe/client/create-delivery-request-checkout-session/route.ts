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
  total: number | null;
  total_cents: number | null;
  currency: string | null;
  status: string | null;
  payment_status: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  expires_at: string | null;
  title: string | null;
};

type GenericErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
};

const REQUEST_ID_MAX_LENGTH = 128;
const DEFAULT_TTL_MINUTES = 45;
const STRIPE_MIN_EXPIRES_AT_MINUTES = 31;
const MAX_REQUEST_BODY_BYTES = 16 * 1024;
const ALLOWED_CURRENCIES = new Set(["usd", "eur", "gbp", "cad"]);
const ALLOWED_PAYABLE_STATUSES = new Set(["pending", "accepted"]);
const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 240;

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
        Pragma: "no-cache",
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

function safeLowerCurrency(v: unknown): string {
  const c = String(v ?? "USD").trim().toLowerCase();
  if (!c) return "usd";
  return ALLOWED_CURRENCIES.has(c) ? c : "usd";
}

function safeTitle(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return raw.slice(0, MAX_TITLE_LENGTH);
}

function safeDescription(value: string): string {
  return value.trim().slice(0, MAX_DESCRIPTION_LENGTH);
}

function isPrivateIpv4(hostname: string): boolean {
  return (
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

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

function isPayableStatus(status: unknown): boolean {
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

  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BODY_BYTES) {
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

function getChargeAmountDollars(request: DeliveryRequestRow): number {
  const totalCents = Number(request.total_cents);
  if (Number.isFinite(totalCents) && totalCents > 0) {
    return totalCents / 100;
  }

  const total = Number(request.total);
  if (Number.isFinite(total) && total > 0) {
    return total;
  }

  throw new Error(
    `Delivery request ${request.id} has no frozen payable amount (total_cents / total).`
  );
}

async function rollbackToUnpaid(
  supabaseAdmin: SupabaseClient,
  deliveryRequestId: string
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("delivery_requests")
    .update({
      payment_status: "unpaid",
      updated_at: new Date().toISOString(),
    })
    .eq("id", deliveryRequestId)
    .neq("payment_status", "paid");

  if (error) {
    logSupabaseError(
      "[create-delivery-request-checkout-session] rollback unpaid failed",
      error,
      { delivery_request_id: deliveryRequestId }
    );
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

function buildCheckoutUrls(deliveryRequestId: string) {
  const normalizedBase = buildPublicBaseUrl();

  const rawSuccessBase =
    process.env.STRIPE_CHECKOUT_SUCCESS_URL || `${normalizedBase}/stripe/success`;

  const rawCancelBase =
    process.env.STRIPE_CHECKOUT_CANCEL_URL || `${normalizedBase}/stripe/cancel`;

  const normalizedSuccessBase = normalizeAbsoluteCheckoutUrl(rawSuccessBase);
  const normalizedCancelBase = normalizeAbsoluteCheckoutUrl(rawCancelBase);

  if (!normalizedSuccessBase || !normalizedCancelBase) {
    throw new Error(
      "Invalid checkout return URLs. Check STRIPE_CHECKOUT_SUCCESS_URL / STRIPE_CHECKOUT_CANCEL_URL."
    );
  }

  const successUrl = `${normalizedSuccessBase.replace(/\/$/, "")}?deliveryRequestId=${encodeURIComponent(deliveryRequestId)}`;
  const cancelUrl = `${normalizedCancelBase.replace(/\/$/, "")}?deliveryRequestId=${encodeURIComponent(deliveryRequestId)}`;

  return { successUrl, cancelUrl };
}

function isOwnedByUser(request: DeliveryRequestRow, userId: string): boolean {
  return request.created_by === userId || request.client_user_id === userId;
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
        "id, created_by, client_user_id, total, total_cents, currency, status, payment_status, stripe_session_id, stripe_payment_intent_id, expires_at, title"
      )
      .eq("id", requestedId)
      .single();

    const request = (data ?? null) as DeliveryRequestRow | null;

    if (reqErr) {
      logSupabaseError(
        "[create-delivery-request-checkout-session] request query failed",
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

    if (!request) {
      return json({ error: "Delivery request not found" }, 404);
    }

    const deliveryRequestId = String(request.id).trim();
    const requestStatus = String(request.status ?? "").trim().toLowerCase();
    const paymentStatus = String(request.payment_status ?? "unpaid")
      .trim()
      .toLowerCase();

    if (!isOwnedByUser(request, user.id)) {
      return json({ error: "Forbidden" }, 403);
    }

    if (isCanceledLikeStatus(requestStatus)) {
      return json({ error: "Delivery request is not payable" }, 409);
    }

    if (!isPayableStatus(requestStatus)) {
      return json({ error: "Delivery request status is not payable" }, 409);
    }

    if (isPaidStatus(paymentStatus)) {
      return json(
        {
          error: "Delivery request already paid",
          delivery_request_id: deliveryRequestId,
        },
        409
      );
    }

    const nowMs = Date.now();
    const defaultExpiresAtMs = nowMs + DEFAULT_TTL_MINUTES * 60 * 1000;
    const minStripeExpiresAtMs =
      nowMs + STRIPE_MIN_EXPIRES_AT_MINUTES * 60 * 1000;

    const expiresAt =
      request.expires_at && Number.isFinite(new Date(request.expires_at).getTime())
        ? new Date(request.expires_at)
        : null;

    if (expiresAt && expiresAt.getTime() < nowMs) {
      const { error: expErr } = await supabaseAdmin
        .from("delivery_requests")
        .update({
          status: "canceled",
          payment_status: "unpaid",
          updated_at: new Date().toISOString(),
        })
        .eq("id", deliveryRequestId)
        .neq("payment_status", "paid");

      if (expErr) {
        logSupabaseError(
          "[create-delivery-request-checkout-session] expire request update failed",
          expErr,
          { delivery_request_id: deliveryRequestId }
        );
      }

      return json({ error: "Delivery request expired" }, 410);
    }

    let effectiveExpiresAtMs = expiresAt?.getTime() ?? defaultExpiresAtMs;

    if (effectiveExpiresAtMs < minStripeExpiresAtMs) {
      effectiveExpiresAtMs = defaultExpiresAtMs;
    }

    if (!expiresAt || effectiveExpiresAtMs !== expiresAt.getTime()) {
      const expIso = new Date(effectiveExpiresAtMs).toISOString();

      const { error: expSetErr } = await supabaseAdmin
        .from("delivery_requests")
        .update({
          expires_at: expIso,
          updated_at: new Date().toISOString(),
        })
        .eq("id", deliveryRequestId);

      if (expSetErr) {
        logSupabaseError(
          "[create-delivery-request-checkout-session] set expires_at failed",
          expSetErr,
          { delivery_request_id: deliveryRequestId }
        );
      }
    }

    const existingSessionId = String(request.stripe_session_id ?? "").trim();

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

        const belongsToSameRequest =
          String(existingSession.client_reference_id ?? "").trim() ===
            deliveryRequestId ||
          String(existingSessionMetadata.delivery_request_id ?? "").trim() ===
            deliveryRequestId ||
          String(existingSessionMetadata.deliveryRequestId ?? "").trim() ===
            deliveryRequestId;

        const belongsToSameUser =
          !existingSessionMetadata.user_id ||
          String(existingSessionMetadata.user_id).trim() === String(user.id);

        const paymentIntentLooksConsistent =
          !request.stripe_payment_intent_id ||
          !existingSessionPi ||
          request.stripe_payment_intent_id === existingSessionPi;

        if (
          reusable &&
          belongsToSameRequest &&
          belongsToSameUser &&
          paymentIntentLooksConsistent
        ) {
          return json({
            url: existingSession.url,
            session_id: existingSession.id,
            id: existingSession.id,
            payment_intent_id: existingSessionPi,
            delivery_request_id: deliveryRequestId,
            reused: true,
          });
        }
      } catch (e: unknown) {
        console.warn(
          "[create-delivery-request-checkout-session] retrieve existing session failed",
          getErrorMessage(e)
        );
      }
    }

    let chargeAmountDollars: number;
    try {
      chargeAmountDollars = getChargeAmountDollars(request);
    } catch (e: unknown) {
      console.error(
        "[create-delivery-request-checkout-session] invalid request amount source",
        {
          delivery_request_id: deliveryRequestId,
          user_id: user.id,
          message: getErrorMessage(e),
        }
      );
      return json({ error: "Invalid delivery request amount" }, 400);
    }

    const amountCents =
      Number.isFinite(Number(request.total_cents)) &&
      Number(request.total_cents) > 0
        ? Math.round(Number(request.total_cents))
        : toCentsFromDollars(chargeAmountDollars);

    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      logSupabaseError(
        "[create-delivery-request-checkout-session] invalid computed amount",
        new Error("Invalid amount"),
        {
          delivery_request_id: deliveryRequestId,
          total_cents: request.total_cents,
          total: request.total,
        }
      );

      return json({ error: "Invalid delivery request amount" }, 400);
    }

    let successUrl = "";
    let cancelUrl = "";

    try {
      const urls = buildCheckoutUrls(deliveryRequestId);
      successUrl = urls.successUrl;
      cancelUrl = urls.cancelUrl;
    } catch (e: unknown) {
      console.error(
        "[create-delivery-request-checkout-session] checkout URL build failed",
        {
          delivery_request_id: deliveryRequestId,
          user_id: user.id,
          message: getErrorMessage(e),
        }
      );

      return json({ error: "Checkout URLs are not configured correctly" }, 500);
    }

    const currency = safeLowerCurrency(request.currency ?? "USD");
    const idempotencyKey = `delivery_checkout_${deliveryRequestId}_${user.id}_${amountCents}_${currency}`;
    const displayTitle = safeTitle(request.title) ?? `MMD Delivery ${deliveryRequestId.slice(0, 8)}`;
    const displayDescription = safeDescription(
      request.title
        ? `${displayTitle} • ${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`
        : `Delivery request payment • ${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`
    );

    if (!isProcessingStatus(paymentStatus)) {
      const nowIso = new Date().toISOString();

      const { error: procErr } = await supabaseAdmin
        .from("delivery_requests")
        .update({
          payment_status: "processing",
          updated_at: nowIso,
        })
        .eq("id", deliveryRequestId)
        .neq("payment_status", "paid");

      if (procErr) {
        logSupabaseError(
          "[create-delivery-request-checkout-session] set processing failed",
          procErr,
          { delivery_request_id: deliveryRequestId }
        );

        return json(
          { error: "Failed to set delivery request processing" },
          500
        );
      }
    }

    let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;

    try {
      session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          client_reference_id: deliveryRequestId,
          expires_at: Math.floor(effectiveExpiresAtMs / 1000),
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency,
                unit_amount: amountCents,
                product_data: {
                  name: displayTitle,
                  description: displayDescription,
                },
              },
            },
          ],
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            delivery_request_id: deliveryRequestId,
            deliveryRequestId: deliveryRequestId,
            user_id: String(user.id),
            amount_cents: String(amountCents),
            amount_dollars: (amountCents / 100).toFixed(2),
            source_route:
              "/api/stripe/client/create-delivery-request-checkout-session",
          },
          payment_intent_data: {
            metadata: {
              delivery_request_id: deliveryRequestId,
              deliveryRequestId: deliveryRequestId,
              user_id: String(user.id),
              amount_cents: String(amountCents),
              amount_dollars: (amountCents / 100).toFixed(2),
              source_route:
                "/api/stripe/client/create-delivery-request-checkout-session",
            },
          },
        },
        { idempotencyKey }
      );
    } catch (e: unknown) {
      await rollbackToUnpaid(supabaseAdmin, deliveryRequestId);

      console.error(
        "[create-delivery-request-checkout-session] stripe create failed",
        {
          delivery_request_id: deliveryRequestId,
          user_id: user.id,
          message: getErrorMessage(e),
        }
      );

      return json({ error: "Stripe session create failed" }, 500);
    }

    if (!session?.id || !session?.url) {
      await rollbackToUnpaid(supabaseAdmin, deliveryRequestId);

      console.error(
        "[create-delivery-request-checkout-session] stripe session missing id/url",
        {
          delivery_request_id: deliveryRequestId,
          user_id: user.id,
          session_id: session?.id ?? null,
          url: session?.url ?? null,
        }
      );

      return json({ error: "Stripe returned an invalid checkout session" }, 500);
    }

    const paymentIntentId = paymentIntentIdFromUnknown(session.payment_intent);

    const { error: saveErr } = await supabaseAdmin
      .from("delivery_requests")
      .update({
        stripe_session_id: session.id,
        stripe_payment_intent_id: paymentIntentId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", deliveryRequestId)
      .neq("payment_status", "paid");

    if (saveErr) {
      logSupabaseError(
        "[create-delivery-request-checkout-session] save stripe refs failed",
        saveErr,
        {
          delivery_request_id: deliveryRequestId,
          session_id: session.id,
          payment_intent_id: paymentIntentId,
        }
      );

      await rollbackToUnpaid(supabaseAdmin, deliveryRequestId);

      return json(
        { error: "Failed to persist Stripe session to delivery request" },
        500
      );
    }

    return json({
      url: session.url,
      session_id: session.id,
      id: session.id,
      payment_intent_id: paymentIntentId,
      delivery_request_id: deliveryRequestId,
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

    console.error("[create-delivery-request-checkout-session] fatal error", {
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