import { NextRequest, NextResponse } from "next/server";
import {
  createClient,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { stripe } from "@/lib/stripe";
import { PAYMENT_METADATA_SCHEMA_VERSION } from "@/lib/requirePaymentIntentSucceeded";
import { assertPlatformFeature } from "@/lib/platformLaunchControl";
import { resolveDeliveryRequestPlatformCountry } from "@/lib/platformCountryResolver";
import { assertCanStartServiceFromOrigin } from "@/lib/originCountyServiceGate";
import { assertStripeCheckoutAllowed } from "@/lib/paymentProviderRouting";
import {
  assertFoodCheckoutCurrencyAllowed,
  foodStripeUnitAmount,
  safeFoodCheckoutCurrency,
} from "@/lib/foodCurrencyGuard";
import { validateDeliveryRequestBeforeCheckout } from "@/lib/deliveryRequestService";
import { buildStripeCheckoutLineItems } from "@/lib/stripeCheckoutBreakdown";
import { buildStripeCheckoutReturnUrls } from "@/lib/productionSite";

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
  net_charge_cents: number | null;
  currency: string | null;
  status: string | null;
  payment_status: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  expires_at: string | null;
  title: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  subtotal: number | null;
  tax: number | null;
  delivery_fee: number | null;
  service_fee: number | null;
  service_fee_cents: number | null;
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
  return safeFoodCheckoutCurrency(v);
}

function safeTitle(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return raw.slice(0, MAX_TITLE_LENGTH);
}

function safeDescription(value: string): string {
  return value.trim().slice(0, MAX_DESCRIPTION_LENGTH);
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
  const supabaseAnonKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

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
  const supabaseServiceKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

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

function buildCheckoutUrls(deliveryRequestId: string) {
  const { successUrl, cancelUrl } = buildStripeCheckoutReturnUrls({
    successQuery: { deliveryRequestId },
    cancelQuery: { deliveryRequestId },
  });

  if (!successUrl || !cancelUrl) {
    throw new Error(
      "Invalid checkout return URLs. Check STRIPE_CHECKOUT_SUCCESS_URL / STRIPE_CHECKOUT_CANCEL_URL.",
    );
  }

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
        "id, created_by, client_user_id, total, total_cents, net_charge_cents, currency, status, payment_status, stripe_session_id, stripe_payment_intent_id, expires_at, title, pickup_lat, pickup_lng, subtotal, tax, delivery_fee, service_fee, service_fee_cents"
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

    const currencyGuard = assertFoodCheckoutCurrencyAllowed(request.currency);
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

    const platformCountry = resolveDeliveryRequestPlatformCountry(request);
    const platformCheckout = await assertPlatformFeature(
      supabaseAdmin,
      platformCountry,
      "delivery",
      "checkout"
    );
    if (platformCheckout.ok === false) {
      return json(
        {
          ok: false,
          error: platformCheckout.error,
          message: platformCheckout.message,
          country_code: platformCheckout.country_code,
        },
        403
      );
    }

    const originCountyGate = await assertCanStartServiceFromOrigin(supabaseAdmin, {
      service: "delivery",
      origin: {
        countryCode: platformCountry,
        lat: request.pickup_lat,
        lng: request.pickup_lng,
      },
    });
    if (!originCountyGate.allowed) {
      return json(
        {
          ok: false,
          error: "delivery_unavailable",
          code: originCountyGate.code,
          title: originCountyGate.title,
          message: originCountyGate.message,
          actions: originCountyGate.actions,
        },
        403
      );
    }

    const stripeGuard = assertStripeCheckoutAllowed(platformCountry);
    if (stripeGuard.ok === false) {
      return json(
        {
          ok: false,
          error: "stripe_disabled_for_country",
          message: stripeGuard.message,
          country_code: platformCountry,
        },
        403
      );
    }

    const pricingCheck = await validateDeliveryRequestBeforeCheckout(
      supabaseAdmin,
      deliveryRequestId
    );
    if (pricingCheck.ok === false) {
      console.error(
        "[create-delivery-request-checkout-session] pricing integrity failed",
        {
          delivery_request_id: deliveryRequestId,
          user_id: user.id,
          error: pricingCheck.error,
        }
      );
      return json(
        {
          ok: false,
          error: "delivery_request_pricing_integrity_failed",
          message: pricingCheck.error,
        },
        409
      );
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

    const grossAmountCents =
      Number.isFinite(Number(request.total_cents)) &&
      Number(request.total_cents) > 0
        ? Math.round(Number(request.total_cents))
        : toCentsFromDollars(chargeAmountDollars);

    // Crédit MMD: charge the frozen net when a reservation was applied. Gross
    // (total_cents) stays authoritative for payouts/commissions. Backward-safe:
    // net is used only when set, positive, and not greater than the gross.
    const netChargeCandidate = Number(request.net_charge_cents);
    const amountCents =
      Number.isFinite(netChargeCandidate) &&
      netChargeCandidate > 0 &&
      netChargeCandidate <= grossAmountCents
        ? Math.round(netChargeCandidate)
        : grossAmountCents;

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
    const stripeUnitAmount = foodStripeUnitAmount(currency, amountCents);
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
          line_items: buildStripeCheckoutLineItems({
            currency,
            productName: displayTitle,
            breakdown: {
              subtotalCents: Math.round(Number(request.subtotal ?? 0) * 100),
              deliveryFeeCents: Math.round(Number(request.delivery_fee ?? 0) * 100),
              serviceFeeCents:
                Number(request.service_fee_cents ?? 0) > 0
                  ? Math.round(Number(request.service_fee_cents))
                  : Math.round(Number(request.service_fee ?? 0) * 100),
              taxCents: Math.round(Number(request.tax ?? 0) * 100),
              totalCents: amountCents,
            },
            labels: {
              subtotal: "Delivery subtotal",
              deliveryFee: "Delivery fee",
              serviceFee: "Service fee",
              tax: "Tax",
            },
          }),
          success_url: successUrl,
          cancel_url: cancelUrl,
          metadata: {
            metadata_schema_version: PAYMENT_METADATA_SCHEMA_VERSION,
            service_type: "delivery",
            module: "delivery",
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
              metadata_schema_version: PAYMENT_METADATA_SCHEMA_VERSION,
              service_type: "delivery",
              module: "delivery",
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
