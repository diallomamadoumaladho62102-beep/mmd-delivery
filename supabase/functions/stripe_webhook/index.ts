import { serve } from "std/http/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

type Json = Record<string, unknown>;

function json(data: Json, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function preflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "stripe-signature, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Cache-Control": "no-store",
    },
  });
}

function log(level: "info" | "warn" | "error", msg: string, ctx: Json = {}) {
  console.log(JSON.stringify({ level, msg, ...ctx }));
}

function asStr(v: unknown) {
  return typeof v === "string" ? v : "";
}

function lower(v: unknown) {
  return String(v ?? "").trim().toLowerCase();
}

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(s);
}

function pickOrderIdFromSession(session: Stripe.Checkout.Session): string | null {
  const meta = session.metadata ?? {};
  const m = meta as Record<string, unknown>;

  const oid =
    asStr(m["order_id"]) ||
    asStr(m["orderId"]) ||
    asStr(m["order"]) ||
    asStr(m["order_uuid"]) ||
    asStr(session.client_reference_id) ||
    "";

  const trimmed = oid.trim();
  return trimmed.length ? trimmed : null;
}

function toExpectedCents(order: {
  total_cents: number | null;
  grand_total: number | null;
  total: number | null;
}) {
  const tc = typeof order.total_cents === "number" ? order.total_cents : null;
  if (tc !== null && Number.isFinite(tc) && tc > 0) return Math.round(tc);

  const dollars =
    typeof order.grand_total === "number"
      ? order.grand_total
      : typeof order.total === "number"
        ? order.total
        : null;

  if (dollars === null || !Number.isFinite(dollars)) return null;
  const cents = Math.round(dollars * 100);
  return cents > 0 ? cents : null;
}

type EventWithLivemode = Stripe.Event & { livemode?: boolean };

type OrderRow = {
  id: string;
  total_cents: number | null;
  grand_total: number | null;
  total: number | null;
  currency: string | null;
  payment_status: string | null;
};

const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

/**
 * IMPORTANT:
 * - Supabase Edge Functions ignore env vars that start with SUPABASE_
 * - So we prefer SB_URL / SB_SERVICE_ROLE_KEY
 * - Fallback to SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY for compatibility
 */
const SB_URL =
  (Deno.env.get("SB_URL") ?? "").trim() ||
  (Deno.env.get("SUPABASE_URL") ?? "").trim() ||
  "";

const SB_SERVICE_ROLE_KEY =
  (Deno.env.get("SB_SERVICE_ROLE_KEY") ?? "").trim() ||
  (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim() ||
  "";

// Optional (not required here, but kept for future use)
const SB_ANON_KEY =
  (Deno.env.get("SB_ANON_KEY") ?? "").trim() ||
  (Deno.env.get("SUPABASE_ANON_KEY") ?? "").trim() ||
  "";

// Safe startup logs (no secrets)
log("info", "stripe_webhook.env_loaded", {
  has_stripe_secret_key: Boolean(STRIPE_SECRET_KEY),
  has_webhook_secret: Boolean(STRIPE_WEBHOOK_SECRET),
  supabase_url: SB_URL ? SB_URL : "(missing)",
  has_service_role_key: Boolean(SB_SERVICE_ROLE_KEY),
  has_anon_key: Boolean(SB_ANON_KEY),
});

const stripe =
  STRIPE_SECRET_KEY
    ? new Stripe(STRIPE_SECRET_KEY, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    })
    : null;

const supabase =
  SB_URL && SB_SERVICE_ROLE_KEY
    ? createClient(SB_URL, SB_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
    : null;

async function auditEvent(params: {
  event_id: string;
  event_type: string;
  livemode: boolean;
  order_id: string | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
  payload: Json;
}) {
  if (!supabase) return;

  const { error } = await supabase
    .from("stripe_webhook_events")
    .upsert([{
      stripe_event_id: params.event_id,
      event_type: params.event_type,
      livemode: params.livemode,
      order_id: params.order_id,
      stripe_session_id: params.stripe_session_id,
      stripe_payment_intent_id: params.stripe_payment_intent_id,
      payload: params.payload,
    }], { onConflict: "stripe_event_id" });

  if (error) {
    log("warn", "stripe_webhook.audit_failed", {
      stripe_event_id: params.event_id,
      error: error.message,
    });
  }
}

async function markSuspiciousUnpaid(order_id: string, reason: string) {
  if (!supabase) return;

  // ⚠️ pas de "review" dans ta DB => fallback safe
  const { error } = await supabase
    .from("orders")
    .update({ payment_status: "unpaid", updated_at: new Date().toISOString() })
    .eq("id", order_id)
    .neq("payment_status", "paid");

  if (error) {
    log("warn", "stripe_webhook.mark_unpaid_failed", {
      order_id,
      reason,
      error: error.message,
    });
  }
}

type AccountEventCandidate = {
  id?: unknown;
};

function pickAccountIdFromEvent(event: Stripe.Event): string {
  // v1: event.data.object is Account
  const acctObj = event.data.object as unknown as AccountEventCandidate;
  const v1 = asStr(acctObj?.id);
  if (v1) return v1;

  // v2: sometimes event.related_object or event.data.related_object contains {id}
  const raw = event as unknown as Record<string, unknown>;
  const related = raw["related_object"];
  if (related && typeof related === "object") {
    const rid = asStr((related as Record<string, unknown>)["id"]);
    if (rid) return rid;
  }

  const data = raw["data"];
  if (data && typeof data === "object") {
    const dataObj = (data as Record<string, unknown>)["object"];
    if (dataObj && typeof dataObj === "object") {
      const did = asStr((dataObj as Record<string, unknown>)["id"]);
      if (did) return did;
    }
    const dataRelated = (data as Record<string, unknown>)["related_object"];
    if (dataRelated && typeof dataRelated === "object") {
      const drid = asStr((dataRelated as Record<string, unknown>)["id"]);
      if (drid) return drid;
    }
  }

  return "";
}

serve(async (req) => {
  const request_id = crypto.randomUUID();

  if (req.method === "OPTIONS") return preflight();
  if (req.method !== "POST") return json({ ok: false, error: "Method Not Allowed" }, 405);

  const sig = req.headers.get("stripe-signature") ?? "";
  if (!sig || !STRIPE_WEBHOOK_SECRET) return new Response("Missing signature", { status: 400 });
  if (!stripe) return new Response("Missing STRIPE_SECRET_KEY", { status: 500 });
  if (!supabase) {
    log("error", "stripe_webhook.missing_supabase_env", {
      request_id,
      sb_url: SB_URL ? SB_URL : "(missing)",
      has_service_role_key: Boolean(SB_SERVICE_ROLE_KEY),
      note:
        "Use SB_URL / SB_SERVICE_ROLE_KEY in env file (SUPABASE_* may be skipped by edge runtime).",
    });
    return new Response("Missing Supabase env vars", { status: 500 });
  }

  // ✅ IMPORTANT: use RAW body bytes for Stripe signature verification
  const rawBody = new Uint8Array(await req.arrayBuffer());

  let event: Stripe.Event;
  try {
    // ✅ FIX: Deno/Supabase Edge requires async webhook verification (SubtleCrypto)
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      sig,
      STRIPE_WEBHOOK_SECRET,
    ) as Stripe.Event;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e ?? "Invalid signature");
    log("warn", "stripe_webhook.invalid_signature", { request_id, error: msg });
    return new Response(`Webhook Error: ${msg}`, { status: 400 });
  }

  const ev = event as EventWithLivemode;
  const event_id = asStr(ev.id);
  const event_type = asStr(ev.type);
  const livemode = Boolean(ev.livemode);

  log("info", "stripe_webhook.received", { request_id, event_id, event_type, livemode });

  // --------------------------------------------
  // 1) PAYMENT EVENTS (Checkout)
  // --------------------------------------------
  const isCheckoutPaidEvent =
    event_type === "checkout.session.completed" ||
    event_type === "checkout.session.async_payment_succeeded";

  const isCheckoutFailedOrExpiredEvent =
    event_type === "checkout.session.expired" ||
    event_type === "checkout.session.async_payment_failed";

  if (isCheckoutPaidEvent || isCheckoutFailedOrExpiredEvent) {
    const session = event.data.object as Stripe.Checkout.Session;

    const orderId = pickOrderIdFromSession(session);
    const stripeSessionId = asStr(session.id) || null;
    const paymentIntentId =
      typeof session.payment_intent === "string" ? session.payment_intent : null;

    const paymentStatus = lower(session.payment_status);
    const sessionStatus = lower(session.status);

    if (!orderId || !isUuid(orderId)) {
      log("error", "stripe_webhook.missing_or_invalid_order_id", {
        request_id,
        event_id,
        event_type,
        session_id: stripeSessionId,
        order_id: orderId,
      });

      await auditEvent({
        event_id,
        event_type,
        livemode,
        order_id: null,
        stripe_session_id: stripeSessionId,
        stripe_payment_intent_id: paymentIntentId,
        payload: {
          reason: "missing_or_invalid_order_id",
          session_id: stripeSessionId,
          payment_status: session.payment_status ?? null,
          status: session.status ?? null,
          client_reference_id: session.client_reference_id ?? null,
          metadata: session.metadata ?? null,
        },
      });

      return json({ received: true, ok: false, error: "Missing/invalid order_id in metadata" }, 200);
    }

    const payloadMinimal: Json = {
      id: session.id,
      payment_status: session.payment_status ?? null,
      status: session.status ?? null,
      client_reference_id: session.client_reference_id ?? null,
      metadata: session.metadata ?? null,
      payment_intent: session.payment_intent ?? null,
      amount_total: typeof session.amount_total === "number" ? session.amount_total : null,
      currency: session.currency ?? null,
    };

    if (
      isCheckoutPaidEvent &&
      paymentStatus !== "paid" &&
      paymentStatus !== "no_payment_required" &&
      sessionStatus !== "complete"
    ) {
      log("warn", "stripe_webhook.checkout_not_paid", {
        request_id,
        event_id,
        event_type,
        order_id: orderId,
        session_id: stripeSessionId,
        stripe_payment_status: paymentStatus,
        stripe_session_status: sessionStatus,
      });

      await auditEvent({
        event_id,
        event_type,
        livemode,
        order_id: orderId,
        stripe_session_id: stripeSessionId,
        stripe_payment_intent_id: paymentIntentId,
        payload: { reason: "checkout_not_paid", ...payloadMinimal },
      });

      return json({
        received: true,
        ok: true,
        ignored: true,
        reason: "not_paid",
        order_id: orderId,
      }, 200);
    }

    const { data: orderRow, error: ordErr } = await supabase
      .from("orders")
      .select("id, total_cents, grand_total, total, currency, payment_status")
      .eq("id", orderId)
      .maybeSingle<OrderRow>();

    if (ordErr || !orderRow) {
      log("error", "stripe_webhook.order_fetch_failed", {
        request_id,
        event_id,
        event_type,
        order_id: orderId,
        error: ordErr?.message ?? "order not found",
        supabase_url: SB_URL || "(missing)",
      });
      return json({ received: true, ok: false, error: "Order fetch failed" }, 500);
    }

    const dbPaymentStatus = lower(orderRow.payment_status);
    if (dbPaymentStatus === "paid") {
      log("info", "stripe_webhook.already_paid_ignored", {
        request_id,
        event_id,
        event_type,
        order_id: orderId,
        session_id: stripeSessionId,
      });

      await auditEvent({
        event_id,
        event_type,
        livemode,
        order_id: orderId,
        stripe_session_id: stripeSessionId,
        stripe_payment_intent_id: paymentIntentId,
        payload: { reason: "already_paid_ignored", ...payloadMinimal },
      });

      return json({
        received: true,
        ok: true,
        ignored: true,
        reason: "already_paid",
        order_id: orderId,
      }, 200);
    }

    const stripeAmount = typeof session.amount_total === "number" ? session.amount_total : null;
    const dbAmount = toExpectedCents({
      total_cents: orderRow.total_cents,
      grand_total: orderRow.grand_total,
      total: orderRow.total,
    });

    const stripeCurrency = lower(session.currency);
    const dbCurrency = lower(orderRow.currency);

    if (isCheckoutPaidEvent) {
      if (stripeAmount === null || dbAmount === null) {
        log("error", "stripe_webhook.amount_missing", {
          request_id,
          event_id,
          order_id: orderId,
          stripe_amount_total: stripeAmount,
          db_total_cents: dbAmount,
        });

        await auditEvent({
          event_id,
          event_type,
          livemode,
          order_id: orderId,
          stripe_session_id: stripeSessionId,
          stripe_payment_intent_id: paymentIntentId,
          payload: { reason: "amount_missing", stripeAmount, dbAmount, ...payloadMinimal },
        });

        await markSuspiciousUnpaid(orderId, "amount_missing");
        return json({ received: true, ok: false, error: "Amount missing (blocked)" }, 200);
      }

      if (stripeCurrency && dbCurrency && stripeCurrency !== dbCurrency) {
        log("error", "stripe_webhook.currency_mismatch", {
          request_id,
          event_id,
          order_id: orderId,
          stripe_currency: stripeCurrency,
          db_currency: dbCurrency,
        });

        await auditEvent({
          event_id,
          event_type,
          livemode,
          order_id: orderId,
          stripe_session_id: stripeSessionId,
          stripe_payment_intent_id: paymentIntentId,
          payload: { reason: "currency_mismatch", stripeCurrency, dbCurrency, ...payloadMinimal },
        });

        await markSuspiciousUnpaid(orderId, "currency_mismatch");
        return json({ received: true, ok: false, error: "Currency mismatch (blocked)" }, 200);
      }

      if (stripeAmount !== dbAmount) {
        log("error", "stripe_webhook.amount_mismatch", {
          request_id,
          event_id,
          order_id: orderId,
          stripe_amount_total: stripeAmount,
          db_total_cents: dbAmount,
        });

        await auditEvent({
          event_id,
          event_type,
          livemode,
          order_id: orderId,
          stripe_session_id: stripeSessionId,
          stripe_payment_intent_id: paymentIntentId,
          payload: { reason: "amount_mismatch", stripeAmount, dbAmount, ...payloadMinimal },
        });

        await markSuspiciousUnpaid(orderId, "amount_mismatch");
        return json({ received: true, ok: false, error: "Amount mismatch (blocked)" }, 200);
      }

      const { data, error } = await supabase.rpc("apply_checkout_paid", {
        p_event_id: event_id,
        p_event_type: event_type,
        p_livemode: livemode,
        p_order_id: orderId,
        p_session_id: stripeSessionId,
        p_payment_intent_id: paymentIntentId,
        p_payload: payloadMinimal,
      });

      if (error) {
        log("error", "stripe_webhook.apply_checkout_paid_failed", {
          request_id,
          event_id,
          event_type,
          order_id: orderId,
          error: error.message,
        });
        return json({
          received: true,
          ok: false,
          error: "DB update failed",
          details: error.message,
        }, 500);
      }

      log("info", "stripe_webhook.metric.paid_revenue", {
        request_id,
        livemode,
        order_id: orderId,
        revenue_cents: dbAmount,
      });

      log("info", "stripe_webhook.checkout_paid_applied", {
        request_id,
        event_id,
        event_type,
        order_id: orderId,
        session_id: stripeSessionId,
        payment_intent_id: paymentIntentId,
        result: (data as unknown) ?? null,
      });

      return json({
        received: true,
        ok: true,
        event_type,
        order_id: orderId,
        stripe_session_id: stripeSessionId,
        stripe_payment_intent_id: paymentIntentId,
        stripe_status: paymentStatus,
        rpc: (data as unknown) ?? null,
      });
    }

    const { data, error } = await supabase.rpc("apply_checkout_failed_or_expired", {
      p_event_id: event_id,
      p_event_type: event_type,
      p_livemode: livemode,
      p_order_id: orderId,
      p_session_id: stripeSessionId,
      p_payment_intent_id: paymentIntentId,
      p_payload: payloadMinimal,
    });

    if (error) {
      log("error", "stripe_webhook.apply_checkout_failed_or_expired_failed", {
        request_id,
        event_id,
        event_type,
        order_id: orderId,
        error: error.message,
      });
      return json({
        received: true,
        ok: false,
        error: "DB update failed",
        details: error.message,
      }, 500);
    }

    log("info", "stripe_webhook.checkout_failed_or_expired_applied", {
      request_id,
      event_id,
      event_type,
      order_id: orderId,
      session_id: stripeSessionId,
      result: (data as unknown) ?? null,
    });

    return json({
      received: true,
      ok: true,
      event_type,
      order_id: orderId,
      stripe_session_id: stripeSessionId,
      stripe_payment_intent_id: paymentIntentId,
      stripe_status: paymentStatus,
      rpc: (data as unknown) ?? null,
    });
  }

  const isAccountUpdated =
    event_type === "account.updated" || event_type === "v2.core.account.updated";

  if (!isAccountUpdated) {
    return json({ received: true, ok: true, ignored: true, event_type }, 200);
  }

  const accountId = pickAccountIdFromEvent(event);

  if (!accountId) {
    log("error", "stripe_webhook.account_missing_id", { request_id, event_id, event_type });
    return json({ received: true, ok: false, error: "Missing account id" }, 200);
  }

  const acct = await stripe.accounts.retrieve(accountId);

  const details_submitted = Boolean(acct.details_submitted);
  const charges_enabled = Boolean(acct.charges_enabled);
  const payouts_enabled = Boolean(acct.payouts_enabled);

  const onboarded = details_submitted && charges_enabled && payouts_enabled;
  const now = new Date().toISOString();

  const { error: dErr } = await supabase
    .from("driver_profiles")
    .update({ stripe_onboarded: onboarded, stripe_onboarded_at: onboarded ? now : null })
    .eq("stripe_account_id", accountId);

  if (dErr) {
    log("error", "stripe_webhook.driver_update_failed", {
      request_id,
      event_id,
      account_id: accountId,
      error: dErr.message,
    });
  }

  const { error: rErr } = await supabase
    .from("restaurant_profiles")
    .update({ stripe_onboarded: onboarded, stripe_onboarded_at: onboarded ? now : null })
    .eq("stripe_account_id", accountId);

  if (rErr) {
    log("error", "stripe_webhook.restaurant_update_failed", {
      request_id,
      event_id,
      account_id: accountId,
      error: rErr.message,
    });
  }

  log("info", "stripe_webhook.account_onboarding_updated", {
    request_id,
    event_id,
    account_id: accountId,
    onboarded,
    details_submitted,
    charges_enabled,
    payouts_enabled,
  });

  return json({
    received: true,
    ok: true,
    event_type,
    stripe_account_id: accountId,
    stripe_onboarded: onboarded,
  });
});