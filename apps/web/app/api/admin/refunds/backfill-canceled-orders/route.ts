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

function getStripe() {
  return new Stripe(getEnv("STRIPE_SECRET_KEY"), {
    apiVersion: "2023-10-16",
  });
}

function isAdminEmail(email: string | null | undefined) {
  const allowed = getEnv("ADMIN_EMAILS")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  return !!email && allowed.includes(email.toLowerCase());
}

function extractBearerToken(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return "";
  return auth.slice(7).trim();
}

async function safeReadJson(req: NextRequest) {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = extractBearerToken(req);

    if (!token) {
      return json({ error: "Missing Authorization Bearer token" }, 401);
    }

    const body = await safeReadJson(req);
    const dryRun = body.dryRun !== false;
    const limit = Math.min(Math.max(Number(body.limit ?? 10), 1), 25);

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

    const { data: orders, error: readError } = await supabaseAdmin
      .from("orders")
      .select(
        `
        id,
        status,
        payment_status,
        refund_status,
        stripe_payment_intent_id,
        stripe_refund_id,
        stripe_refunded_at,
        cancel_reason,
        cancelled_by,
        cancelled_at
      `
      )
      .eq("status", "canceled")
      .eq("payment_status", "paid")
      .eq("refund_status", "full_refund_required")
      .not("stripe_payment_intent_id", "is", null)
      .is("stripe_refund_id", null)
      .is("stripe_refunded_at", null)
      .order("cancelled_at", { ascending: true })
      .limit(limit);

    if (readError) {
      return json({ error: readError.message }, 500);
    }

    const eligible = orders ?? [];

    if (dryRun) {
      return json({
        ok: true,
        dryRun: true,
        count: eligible.length,
        orders: eligible.map((o: any) => ({
          id: o.id,
          payment_status: o.payment_status,
          refund_status: o.refund_status,
          stripe_payment_intent_id: o.stripe_payment_intent_id,
          cancel_reason: o.cancel_reason,
          cancelled_by: o.cancelled_by,
          cancelled_at: o.cancelled_at,
        })),
      });
    }

    const stripe = getStripe();
    const results: any[] = [];

    for (const order of eligible as any[]) {
      try {
        const refund = await stripe.refunds.create(
          {
            payment_intent: order.stripe_payment_intent_id,
            reason: "requested_by_customer",
            metadata: {
              order_id: order.id,
              backfill: "true",
              cancel_reason: String(order.cancel_reason ?? ""),
              cancelled_by: String(order.cancelled_by ?? ""),
            },
          },
          {
            idempotencyKey: `backfill_refund_order_${order.id}`,
          }
        );

        const { error: updateError } = await supabaseAdmin
          .from("orders")
          .update({
            refund_status: "refunded",
            stripe_refund_id: refund.id,
            stripe_refunded_at: nowIso(),
          })
          .eq("id", order.id)
          .eq("refund_status", "full_refund_required")
          .is("stripe_refund_id", null)
          .is("stripe_refunded_at", null);

        if (updateError) {
          results.push({
            id: order.id,
            ok: false,
            refund_id: refund.id,
            error: updateError.message,
          });
          continue;
        }

        results.push({
          id: order.id,
          ok: true,
          refund_id: refund.id,
          stripe_status: refund.status,
        });
      } catch (e: any) {
        await supabaseAdmin
          .from("orders")
          .update({
            refund_status: "refund_failed",
          })
          .eq("id", order.id)
          .eq("refund_status", "full_refund_required");

        results.push({
          id: order.id,
          ok: false,
          error: e?.message ?? "Refund failed",
        });
      }
    }

    return json({
      ok: true,
      dryRun: false,
      processed: results.length,
      results,
    });
  } catch (e: any) {
    return json({ error: e?.message ?? "Server error" }, 500);
  }
}

export async function GET() {
  return json({ error: "Method not allowed" }, 405);
}