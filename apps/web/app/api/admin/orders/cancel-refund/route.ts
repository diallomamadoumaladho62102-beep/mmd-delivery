import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

function nowIso() {
  return new Date().toISOString();
}

function extractBearerToken(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return "";
  return auth.slice(7).trim();
}

function isAdminEmail(email: string | null | undefined) {
  const allowed = getEnv("ADMIN_EMAILS")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  return !!email && allowed.includes(email.toLowerCase());
}

async function safeReadJson(req: NextRequest) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

function getStripe() {
  return new Stripe(getEnv("STRIPE_SECRET_KEY"), {
    apiVersion: "2023-10-16",
  });
}

export async function POST(req: NextRequest) {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      return json({ error: "Missing Authorization Bearer token" }, 401);
    }

    const body = await safeReadJson(req);
    const orderId = String(body.orderId ?? body.order_id ?? "").trim();
    const adminReason = String(body.reason ?? "admin_cancel_refund").trim();

    if (!orderId) {
      return json({ error: "Missing orderId" }, 400);
    }

    const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
    const supabaseAnonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    const supabaseServiceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false },
      global: {
        headers: { Authorization: `Bearer ${token}` },
      },
    });

    const { data: userData, error: userError } =
      await supabaseUser.auth.getUser();

    const user = userData?.user;

    if (userError || !user?.id) {
      return json({ error: "Invalid token" }, 401);
    }

    if (!isAdminEmail(user.email)) {
      return json({ error: "Forbidden: admin only" }, 403);
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false },
    });

    const { data: order, error: readError } = await supabaseAdmin
      .from("orders")
      .select(
        `
        id,
        status,
        payment_status,
        refund_status,
        stripe_payment_intent_id,
        stripe_refund_id,
        stripe_refunded_at
      `
      )
      .eq("id", orderId)
      .maybeSingle();

    if (readError) {
      return json({ error: readError.message }, 500);
    }

    if (!order) {
      return json({ error: "Order not found" }, 404);
    }

    let stripeRefund: any = null;

    const alreadyRefunded =
      !!order.stripe_refund_id || !!order.stripe_refunded_at;

    const canRefund =
      order.payment_status === "paid" &&
      !!order.stripe_payment_intent_id &&
      !alreadyRefunded;

    if (canRefund) {
      const stripe = getStripe();

      const refund = await stripe.refunds.create(
        {
          payment_intent: order.stripe_payment_intent_id,
          reason: "requested_by_customer",
          metadata: {
            order_id: orderId,
            admin_id: user.id,
            admin_email: user.email ?? "",
            reason: adminReason,
          },
        },
        {
          idempotencyKey: `admin_cancel_refund_${orderId}`,
        }
      );

      stripeRefund = {
        id: refund.id,
        status: refund.status,
      };
    }

    const updatePayload: Record<string, unknown> = {
      status: "canceled",
      driver_id: null,
      cancel_reason: adminReason,
      cancelled_by: "admin",
      cancelled_at: nowIso(),
      refund_status: canRefund
        ? "refunded"
        : alreadyRefunded
          ? "refunded"
          : order.payment_status === "paid"
            ? "missing_payment_intent"
            : "not_paid",
    };

    if (stripeRefund?.id) {
      updatePayload.stripe_refund_id = stripeRefund.id;
      updatePayload.stripe_refunded_at = nowIso();
    }

    const { data: updated, error: updateError } = await supabaseAdmin
      .from("orders")
      .update(updatePayload)
      .eq("id", orderId)
      .select("id,status,refund_status,stripe_refund_id,stripe_refunded_at")
      .maybeSingle();

    if (updateError) {
      return json({ error: updateError.message }, 500);
    }

    return json({
      ok: true,
      order: updated,
      alreadyRefunded,
      refundedNow: !!stripeRefund?.id,
      stripeRefund,
      message: "Admin cancel/refund completed.",
    });
  } catch (e: any) {
    console.log("Admin cancel refund error:", e?.message ?? e);
    return json({ error: e?.message ?? "Server error" }, 500);
  }
}

export async function GET() {
  return json({ error: "Method not allowed" }, 405);
}