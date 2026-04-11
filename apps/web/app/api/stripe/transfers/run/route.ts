import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";
import {
  AdminAccessError,
  assertCanRetryPayout,
} from "@/lib/adminServer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  order_id?: string;
  orderId?: string;
  payment_intent_id?: string;
  paymentIntentId?: string;
  charge_id?: string;
  chargeId?: string;
  target?: "restaurant" | "driver";
  dry_run?: boolean;
};

type OrderRow = {
  id: string;
  status: string | null;
  payment_status: string | null;
  currency: string | null;
  driver_id: string | null;
  restaurant_id: string | null;
  restaurant_user_id: string | null;
  subtotal_cents: number | null;
  delivery_fee_cents: number | null;
  total_cents: number | null;
  grand_total: number | null;
  stripe_payment_intent_id: string | null;
  driver_paid_out: boolean | null;
  restaurant_paid_out: boolean | null;
  driver_transfer_id: string | null;
  restaurant_transfer_id: string | null;
  picked_up_at?: string | null;
  delivered_confirmed_at?: string | null;
};

type CommissionRow = {
  order_id: string;
  restaurant_release_status: string | null;
  restaurant_released_at: string | null;
  driver_release_status: string | null;
  driver_released_at: string | null;
  platform_release_status: string | null;
  platform_released_at: string | null;
  driver_cents?: number | null;
  restaurant_cents?: number | null;
  platform_cents?: number | null;
  driver_amount?: number | null;
  restaurant_amount?: number | null;
  platform_amount?: number | null;
  currency?: string | null;
};

type RestaurantProfileRow = {
  user_id: string | null;
  stripe_account_id: string | null;
};

type DriverProfileRow = {
  user_id: string | null;
  stripe_account_id: string | null;
};

type OrderPayoutRow = {
  id: string;
  order_id: string;
  target: "restaurant" | "driver";
  status: "pending" | "locked" | "succeeded" | "failed";
  currency: string;
  amount_cents: number | null;
  destination_account_id: string | null;
  source_charge_id: string | null;
  stripe_transfer_id: string | null;
  idempotency_key: string | null;
  locked_at: string | null;
  locked_by: string | null;
  failure_code: string | null;
  failure_message: string | null;
  last_error: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  succeeded_at: string | null;
  failed_at: string | null;
};

type VerifyRestaurantOrderRow = {
  id: string;
  restaurant_paid_out: boolean | null;
  restaurant_transfer_id: string | null;
};

type VerifyDriverOrderRow = {
  id: string;
  driver_paid_out: boolean | null;
  driver_transfer_id: string | null;
};

type GenericErrorLike = {
  code?: unknown;
  message?: unknown;
  details?: unknown;
  hint?: unknown;
  type?: unknown;
  statusCode?: unknown;
  requestId?: unknown;
};

const ORDER_ID_MAX_LENGTH = 128;
const STRIPE_ID_MAX_LENGTH = 255;
const ALLOWED_CURRENCIES = new Set(["usd", "eur", "gbp", "cad"]);
const JSON_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

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

function getStripeErrorType(value: unknown): string | null {
  const err = asErrorLike(value);
  return typeof err?.type === "string" ? err.type : null;
}

function getStripeStatusCode(value: unknown): number | null {
  const err = asErrorLike(value);
  return typeof err?.statusCode === "number" ? err.statusCode : null;
}

function getStripeRequestId(value: unknown): string | null {
  const err = asErrorLike(value);
  return typeof err?.requestId === "string" ? err.requestId : null;
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: JSON_HEADERS,
  });
}

function getStripe() {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new Error("Missing STRIPE_SECRET_KEY");

  return new Stripe(secret, {
    apiVersion: "2023-10-16",
  });
}

function getSupabaseAdmin(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "Missing Supabase env vars (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)"
    );
  }

  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
}

function lower(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function toPositiveIntOrNull(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n);
}

function dollarsToCentsOrNull(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100);
}

function normalizeCurrency(v: unknown): string {
  const c = lower(v || "usd");
  if (!c) return "usd";
  return ALLOWED_CURRENCIES.has(c) ? c : "usd";
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);

  if (aBytes.length !== bBytes.length) return false;

  let result = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    result |= aBytes[i] ^ bBytes[i];
  }

  return result === 0;
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

function logStripeError(
  prefix: string,
  err: unknown,
  extra?: Record<string, unknown>
) {
  console.error(prefix, {
    type: getStripeErrorType(err),
    code: getErrorCode(err),
    message: getErrorMessage(err),
    statusCode: getStripeStatusCode(err),
    requestId: getStripeRequestId(err),
    ...extra,
  });
}

async function parseBody(req: NextRequest): Promise<Body> {
  try {
    return (await req.json()) as Body;
  } catch {
    throw new Error("Invalid JSON body");
  }
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

function normalizeStripeIdentifier(
  value: unknown,
  allowedPrefixes: string[]
): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";

  if (raw.length > STRIPE_ID_MAX_LENGTH) {
    throw new Error("Invalid Stripe identifier");
  }

  if (!/^[A-Za-z0-9_]+$/.test(raw)) {
    throw new Error("Invalid Stripe identifier");
  }

  const hasAllowedPrefix = allowedPrefixes.some((prefix) =>
    raw.startsWith(prefix)
  );

  if (!hasAllowedPrefix) {
    throw new Error("Invalid Stripe identifier");
  }

  return raw;
}

function normalizeTarget(value: unknown): "restaurant" | "driver" {
  const v = lower(value);
  if (v === "restaurant" || v === "driver") return v;
  throw new Error("Invalid target");
}

async function authorizeRequest(req: NextRequest): Promise<string> {
  const adminSecret = process.env.STRIPE_TRANSFERS_ADMIN_SECRET;
  const provided = req.headers.get("x-admin-secret") || "";

  if (adminSecret && provided && timingSafeEqualStrings(provided, adminSecret)) {
    return "secret:stripe_transfers_admin_secret";
  }

  const admin = await assertCanRetryPayout();
  return admin.userId;
}

function resolveTransferSourcePaymentIntent(
  body: Body,
  order: OrderRow
): string | null {
  const fromBody = String(
    body.payment_intent_id ?? body.paymentIntentId ?? ""
  ).trim();
  if (fromBody) return fromBody;

  const fromOrder = String(order.stripe_payment_intent_id ?? "").trim();
  if (fromOrder) return fromOrder;

  return null;
}

function resolveRestaurantAmountCents(
  order: OrderRow,
  commission: CommissionRow | null
): number | null {
  return (
    toPositiveIntOrNull(commission?.restaurant_cents) ??
    dollarsToCentsOrNull(commission?.restaurant_amount) ??
    toPositiveIntOrNull(order.subtotal_cents) ??
    null
  );
}

function resolveDriverAmountCents(
  order: OrderRow,
  commission: CommissionRow | null
): number | null {
  return (
    toPositiveIntOrNull(commission?.driver_cents) ??
    dollarsToCentsOrNull(commission?.driver_amount) ??
    toPositiveIntOrNull(order.delivery_fee_cents) ??
    null
  );
}

function makeIdempotencyKey(orderId: string, target: "restaurant" | "driver") {
  return `transfer:${orderId}:${target}`;
}

function mapRpcErrorToHttpStatus(message: string): number {
  const m = lower(message);

  if (m.includes("not found")) return 404;
  if (m.includes("not paid")) return 409;
  if (m.includes("already paid")) return 409;
  if (m.includes("not yet eligible")) return 409;
  if (m.includes("required")) return 400;
  if (m.includes("must be")) return 400;

  return 500;
}

function isOrderAlreadyPaidOut(
  order: OrderRow,
  target: "restaurant" | "driver"
): boolean {
  if (target === "restaurant") {
    return (
      order.restaurant_paid_out === true &&
      isNonEmptyString(order.restaurant_transfer_id)
    );
  }

  return (
    order.driver_paid_out === true &&
    isNonEmptyString(order.driver_transfer_id)
  );
}

function getExistingTransferId(
  order: OrderRow,
  target: "restaurant" | "driver"
): string | null {
  return target === "restaurant"
    ? order.restaurant_transfer_id ?? null
    : order.driver_transfer_id ?? null;
}

function isPaidPaymentStatus(status: unknown): boolean {
  return lower(status) === "paid";
}

function isCanceledOrderStatus(status: unknown): boolean {
  const s = lower(status);
  return s === "canceled" || s === "cancelled" || s === "expired";
}

function sanitizeOrderForLog(order: OrderRow) {
  return {
    id: order.id,
    status: order.status,
    payment_status: order.payment_status,
    driver_id: order.driver_id,
    restaurant_id: order.restaurant_id,
    restaurant_user_id: order.restaurant_user_id,
    stripe_payment_intent_id: order.stripe_payment_intent_id,
  };
}

export async function POST(req: NextRequest) {
  try {
    const actor = await authorizeRequest(req);
    const stripe = getStripe();
    const supabaseAdmin = getSupabaseAdmin();
    const body = await parseBody(req);

    let orderId = "";
    let target: "restaurant" | "driver";
    let providedChargeId = "";
    let providedPaymentIntentId = "";

    try {
      orderId = normalizeOrderId(body.order_id ?? body.orderId);
      target = normalizeTarget(body.target);
      providedChargeId = normalizeStripeIdentifier(
        body.charge_id ?? body.chargeId,
        ["ch_"]
      );
      providedPaymentIntentId = normalizeStripeIdentifier(
        body.payment_intent_id ?? body.paymentIntentId,
        ["pi_"]
      );
    } catch (e: unknown) {
      return json({ error: getErrorMessage(e) }, 400);
    }

    const dryRun = body.dry_run === true;

    if (!orderId) {
      return json({ error: "order_id required" }, 400);
    }

    const { data: order, error: oErr } = await supabaseAdmin
      .from("orders")
      .select(
        `
        id,
        status,
        payment_status,
        currency,
        driver_id,
        restaurant_id,
        restaurant_user_id,
        subtotal_cents,
        delivery_fee_cents,
        total_cents,
        grand_total,
        stripe_payment_intent_id,
        driver_paid_out,
        restaurant_paid_out,
        driver_transfer_id,
        restaurant_transfer_id,
        picked_up_at,
        delivered_confirmed_at
      `
      )
      .eq("id", orderId)
      .single<OrderRow>();

    if (oErr || !order) {
      if (oErr) {
        logSupabaseError("[transfers/run] order lookup failed", oErr, {
          order_id: orderId,
          actor,
        });
      }

      return json({ error: "Order not found" }, 404);
    }

    if (isCanceledOrderStatus(order.status)) {
      return json({ error: "Order is not eligible for transfer" }, 409);
    }

    if (!isPaidPaymentStatus(order.payment_status)) {
      return json({ error: "Order is not paid" }, 409);
    }

    if (isOrderAlreadyPaidOut(order, target)) {
      return json(
        {
          ok: true,
          already_succeeded: true,
          order_id: order.id,
          target,
          transfer_id: getExistingTransferId(order, target),
        },
        200
      );
    }

    const { data: commission, error: comErr } = await supabaseAdmin
      .from("order_commissions")
      .select(
        `
        order_id,
        restaurant_release_status,
        restaurant_released_at,
        driver_release_status,
        driver_released_at,
        platform_release_status,
        platform_released_at,
        driver_cents,
        restaurant_cents,
        platform_cents,
        driver_amount,
        restaurant_amount,
        platform_amount,
        currency
      `
      )
      .eq("order_id", orderId)
      .maybeSingle<CommissionRow>();

    if (comErr) {
      logSupabaseError("[transfers/run] commission lookup failed", comErr, {
        order_id: order.id,
        actor,
      });

      return json({ error: "Order commissions lookup failed" }, 500);
    }

    const currency = normalizeCurrency(order.currency || commission?.currency);

    let destination: string | null = null;
    let amount: number | null = null;

    if (target === "restaurant") {
      const restaurantUserId = order.restaurant_user_id ?? order.restaurant_id;

      if (!restaurantUserId) {
        return json({ error: "Order missing restaurant reference" }, 400);
      }

      const { data: rest, error: restErr } = await supabaseAdmin
        .from("restaurant_profiles")
        .select("user_id, stripe_account_id")
        .eq("user_id", restaurantUserId)
        .single<RestaurantProfileRow>();

      if (restErr) {
        logSupabaseError("[transfers/run] restaurant lookup failed", restErr, {
          order_id: order.id,
          restaurant_user_id: restaurantUserId,
          actor,
        });

        return json({ error: "Restaurant profile lookup failed" }, 500);
      }

      if (!rest?.stripe_account_id) {
        return json({ error: "Restaurant payout account missing" }, 400);
      }

      amount = resolveRestaurantAmountCents(order, commission ?? null);
      destination = String(rest.stripe_account_id).trim();

      if (!amount || amount <= 0) {
        console.error("[transfers/run] invalid restaurant amount", {
          actor,
          order: sanitizeOrderForLog(order),
          commission: {
            order_id: commission?.order_id ?? null,
            restaurant_cents: commission?.restaurant_cents ?? null,
            restaurant_amount: commission?.restaurant_amount ?? null,
          },
        });

        return json({ error: "Invalid restaurant amount" }, 400);
      }
    }

    if (target === "driver") {
      if (!order.driver_id) {
        return json({ error: "Order missing driver reference" }, 400);
      }

      const { data: drv, error: drvErr } = await supabaseAdmin
        .from("driver_profiles")
        .select("user_id, stripe_account_id")
        .eq("user_id", order.driver_id)
        .single<DriverProfileRow>();

      if (drvErr) {
        logSupabaseError("[transfers/run] driver lookup failed", drvErr, {
          order_id: order.id,
          driver_id: order.driver_id,
          actor,
        });

        return json({ error: "Driver profile lookup failed" }, 500);
      }

      if (!drv?.stripe_account_id) {
        return json({ error: "Driver payout account missing" }, 400);
      }

      amount = resolveDriverAmountCents(order, commission ?? null);
      destination = String(drv.stripe_account_id).trim();

      if (!amount || amount <= 0) {
        console.error("[transfers/run] invalid driver amount", {
          actor,
          order: sanitizeOrderForLog(order),
          commission: {
            order_id: commission?.order_id ?? null,
            driver_cents: commission?.driver_cents ?? null,
            driver_amount: commission?.driver_amount ?? null,
          },
        });

        return json({ error: "Invalid driver amount" }, 400);
      }
    }

    if (!destination) {
      return json({ error: "Could not resolve payout destination" }, 400);
    }

    if (!/^acct_[A-Za-z0-9]+$/.test(destination)) {
      console.error("[transfers/run] invalid destination account id", {
        actor,
        order_id: order.id,
        target,
      });
      return json({ error: "Invalid payout destination" }, 400);
    }

    let sourceChargeId: string | null = null;

    if (providedChargeId) {
      sourceChargeId = providedChargeId;
    } else {
      const paymentIntentId =
        providedPaymentIntentId ||
        normalizeStripeIdentifier(
          resolveTransferSourcePaymentIntent(body, order),
          ["pi_"]
        );

      if (!paymentIntentId) {
        return json(
          {
            error:
              "Missing charge source. Provide charge_id or ensure order has a valid Stripe payment intent.",
          },
          400
        );
      }

      try {
        const pi = await stripe.paymentIntents.retrieve(paymentIntentId);

        if (
          pi.metadata &&
          typeof pi.metadata === "object" &&
          isNonEmptyString(pi.metadata.order_id) &&
          String(pi.metadata.order_id).trim() !== order.id
        ) {
          console.error("[transfers/run] payment intent order mismatch", {
            actor,
            order_id: order.id,
            payment_intent_id: paymentIntentId,
            metadata_order_id: String(pi.metadata.order_id).trim(),
          });

          return json({ error: "Payment source does not match order" }, 409);
        }

        const latest = pi.latest_charge;

        if (typeof latest === "string" && latest.trim()) {
          sourceChargeId = latest.trim();
        }
      } catch (e: unknown) {
        logStripeError("[transfers/run] payment intent retrieve failed", e, {
          order_id: order.id,
          payment_intent_id: paymentIntentId,
          actor,
        });

        return json(
          { error: "Failed to retrieve payment intent from Stripe" },
          500
        );
      }
    }

    if (!sourceChargeId) {
      return json(
        { error: "Could not resolve source charge for transfer funding" },
        400
      );
    }

    if (!/^ch_[A-Za-z0-9]+$/.test(sourceChargeId)) {
      return json({ error: "Invalid source charge id" }, 400);
    }

    const transferGroup = `ORDER_${order.id}`;
    const idempotencyKey = makeIdempotencyKey(order.id, target);

    // IMPORTANT:
    // dry_run must not create / reserve / lock any payout row in DB.
    // It validates the whole transfer input set, but leaves no side effects.
    if (dryRun) {
      return json({
        ok: true,
        dry_run: true,
        order_id: order.id,
        target,
        source_charge_id: sourceChargeId,
        transfer_group: transferGroup,
        idempotency_key: idempotencyKey,
        amount,
        currency: currency.toUpperCase(),
        destination,
      });
    }

    const { data: reserved, error: reserveErr } = await supabaseAdmin.rpc(
      "reserve_order_payout",
      {
        p_order_id: order.id,
        p_target: target,
        p_amount_cents: amount,
        p_currency: currency.toUpperCase(),
        p_destination_account_id: destination,
        p_source_charge_id: sourceChargeId,
        p_idempotency_key: idempotencyKey,
        p_locked_by: actor,
      }
    );

    if (reserveErr) {
      logSupabaseError("[transfers/run] reserve_order_payout failed", reserveErr, {
        order_id: order.id,
        target,
        actor,
      });

      const message = reserveErr.message || "Failed to reserve order payout";

      return json({ error: message }, mapRpcErrorToHttpStatus(message));
    }

    const payout = reserved as OrderPayoutRow | null;

    if (!payout) {
      return json({ error: "Payout reservation returned empty result" }, 500);
    }

    if (payout.order_id !== order.id || payout.target !== target) {
      console.error("[transfers/run] payout reservation mismatch", {
        actor,
        expected_order_id: order.id,
        actual_order_id: payout.order_id,
        expected_target: target,
        actual_target: payout.target,
      });

      return json({ error: "Invalid payout reservation state" }, 409);
    }

    if (payout.status === "succeeded" && payout.stripe_transfer_id) {
      return json(
        {
          ok: true,
          dry_run: false,
          already_succeeded: true,
          order_id: order.id,
          payout_id: payout.id,
          target,
          transfer_id: payout.stripe_transfer_id,
          transfer_group: transferGroup,
          idempotency_key: payout.idempotency_key,
          amount: payout.amount_cents,
          currency: payout.currency,
        },
        200
      );
    }

    if (
      payout.amount_cents !== amount ||
      lower(payout.currency) !== lower(currency) ||
      payout.destination_account_id !== destination ||
      payout.source_charge_id !== sourceChargeId
    ) {
      console.error("[transfers/run] reserved payout mismatch", {
        actor,
        order_id: order.id,
        payout_id: payout.id,
        expected: {
          amount,
          currency,
          destination,
          sourceChargeId,
        },
        actual: {
          amount: payout.amount_cents,
          currency: payout.currency,
          destination: payout.destination_account_id,
          sourceChargeId: payout.source_charge_id,
        },
      });

      return json({ error: "Reserved payout state mismatch" }, 409);
    }

    let transfer: Stripe.Transfer;

    try {
      transfer = await stripe.transfers.create(
        {
          amount: payout.amount_cents as number,
          currency: lower(payout.currency || currency),
          destination: payout.destination_account_id as string,
          transfer_group: transferGroup,
          source_transaction: payout.source_charge_id as string,
          metadata: {
            role: target,
            order_id: order.id,
            payout_id: payout.id,
            source_charge: payout.source_charge_id as string,
          },
        },
        {
          idempotencyKey: payout.idempotency_key ?? idempotencyKey,
        }
      );
    } catch (e: unknown) {
      logStripeError("[transfers/run] transfer create failed", e, {
        order_id: order.id,
        payout_id: payout.id,
        target,
        source_charge_id: payout.source_charge_id,
        idempotency_key: payout.idempotency_key ?? idempotencyKey,
        actor,
      });

      const nowIso = new Date().toISOString();

      const { error: failErr } = await supabaseAdmin
        .from("order_payouts")
        .update({
          status: "failed",
          failure_code: getErrorCode(e),
          failure_message: getErrorMessage(e),
          last_error: JSON.stringify({
            type: getStripeErrorType(e),
            code: getErrorCode(e),
            message: getErrorMessage(e),
            statusCode: getStripeStatusCode(e),
            requestId: getStripeRequestId(e),
          }),
          failed_at: nowIso,
          updated_at: nowIso,
        })
        .eq("id", payout.id);

      if (failErr) {
        logSupabaseError("[transfers/run] mark payout failed failed", failErr, {
          order_id: order.id,
          payout_id: payout.id,
          actor,
        });
      }

      return json({ error: "Stripe transfer failed" }, 500);
    }

    const nowIso = new Date().toISOString();

    const { error: payoutUpdErr } = await supabaseAdmin
      .from("order_payouts")
      .update({
        status: "succeeded",
        stripe_transfer_id: transfer.id,
        failure_code: null,
        failure_message: null,
        last_error: null,
        succeeded_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", payout.id)
      .eq("status", "locked");

    if (payoutUpdErr) {
      logSupabaseError("[transfers/run] save payout success failed", payoutUpdErr, {
        order_id: order.id,
        payout_id: payout.id,
        transfer_id: transfer.id,
        actor,
      });

      return json(
        {
          error: "Transfer created but payout state update failed",
          payout_id: payout.id,
          transfer_id: transfer.id,
        },
        500
      );
    }

    if (target === "restaurant") {
      const { error: updErr } = await supabaseAdmin
        .from("orders")
        .update({
          restaurant_paid_out: true,
          restaurant_paid_out_at: nowIso,
          restaurant_transfer_id: transfer.id,
          updated_at: nowIso,
        })
        .eq("id", order.id)
        .or("restaurant_paid_out.is.null,restaurant_paid_out.eq.false")
        .is("restaurant_transfer_id", null);

      if (updErr) {
        logSupabaseError("[transfers/run] save restaurant payout failed", updErr, {
          order_id: order.id,
          payout_id: payout.id,
          transfer_id: transfer.id,
          actor,
        });

        return json(
          {
            error: "Transfer created and payout saved, but order update failed",
            payout_id: payout.id,
            transfer_id: transfer.id,
          },
          500
        );
      }

      const { data: verifyOrder, error: verifyErr } = await supabaseAdmin
        .from("orders")
        .select("id, restaurant_paid_out, restaurant_transfer_id")
        .eq("id", order.id)
        .single<VerifyRestaurantOrderRow>();

      if (verifyErr) {
        logSupabaseError("[transfers/run] verify restaurant payout failed", verifyErr, {
          order_id: order.id,
          payout_id: payout.id,
          transfer_id: transfer.id,
          actor,
        });

        return json(
          {
            error: "Transfer created and payout saved, but verification failed",
            payout_id: payout.id,
            transfer_id: transfer.id,
          },
          500
        );
      }

      if (
        verifyOrder?.restaurant_paid_out !== true ||
        verifyOrder?.restaurant_transfer_id !== transfer.id
      ) {
        return json(
          {
            error:
              "Transfer created and payout saved, but restaurant order state is still inconsistent",
            payout_id: payout.id,
            transfer_id: transfer.id,
            order_id: order.id,
          },
          409
        );
      }
    }

    if (target === "driver") {
      const { error: updErr } = await supabaseAdmin
        .from("orders")
        .update({
          driver_paid_out: true,
          driver_paid_out_at: nowIso,
          driver_transfer_id: transfer.id,
          updated_at: nowIso,
        })
        .eq("id", order.id)
        .or("driver_paid_out.is.null,driver_paid_out.eq.false")
        .is("driver_transfer_id", null);

      if (updErr) {
        logSupabaseError("[transfers/run] save driver payout failed", updErr, {
          order_id: order.id,
          payout_id: payout.id,
          transfer_id: transfer.id,
          actor,
        });

        return json(
          {
            error: "Transfer created and payout saved, but order update failed",
            payout_id: payout.id,
            transfer_id: transfer.id,
          },
          500
        );
      }

      const { data: verifyOrder, error: verifyErr } = await supabaseAdmin
        .from("orders")
        .select("id, driver_paid_out, driver_transfer_id")
        .eq("id", order.id)
        .single<VerifyDriverOrderRow>();

      if (verifyErr) {
        logSupabaseError("[transfers/run] verify driver payout failed", verifyErr, {
          order_id: order.id,
          payout_id: payout.id,
          transfer_id: transfer.id,
          actor,
        });

        return json(
          {
            error: "Transfer created and payout saved, but verification failed",
            payout_id: payout.id,
            transfer_id: transfer.id,
          },
          500
        );
      }

      if (
        verifyOrder?.driver_paid_out !== true ||
        verifyOrder?.driver_transfer_id !== transfer.id
      ) {
        return json(
          {
            error:
              "Transfer created and payout saved, but driver order state is still inconsistent",
            payout_id: payout.id,
            transfer_id: transfer.id,
            order_id: order.id,
          },
          409
        );
      }
    }

    return json({
      ok: true,
      dry_run: false,
      order_id: order.id,
      payout_id: payout.id,
      target,
      source_charge_id: payout.source_charge_id,
      transfer_id: transfer.id,
      transfer_group: transferGroup,
      idempotency_key: payout.idempotency_key,
      amount: payout.amount_cents,
      currency: payout.currency,
    });
  } catch (e: unknown) {
    if (e instanceof AdminAccessError) {
      return json({ error: "Forbidden" }, e.status);
    }

    console.error("[transfers/run] fatal error", {
      message: getErrorMessage(e),
    });

    return json({ error: "Internal server error" }, 500);
  }
}
