// supabase/functions/create_payment_intent/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Stripe from "npm:stripe";
import { createClient } from "npm:@supabase/supabase-js";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function toPositiveNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function resolveOrderAmountCents(order: {
  total_cents?: unknown;
  total?: unknown;
  grand_total?: unknown;
}): number | null {
  const totalCents = toPositiveNumber(order.total_cents);
  if (totalCents != null) return Math.round(totalCents);

  const total = toPositiveNumber(order.total);
  if (total != null) return Math.round(total * 100);

  const grandTotal = toPositiveNumber(order.grand_total);
  if (grandTotal != null) return Math.round(grandTotal * 100);

  return null;
}

function buildPaymentIntentIdempotencyKey(
  orderId: string,
  amount: number,
  currency: string,
): string {
  return `mmd-order-pi-${orderId}-${amount}-${currency}`.slice(0, 255);
}

async function createOrderPaymentIntent(
  orderId: string,
  userId: string,
  amount: number,
  currency: string,
): Promise<Stripe.PaymentIntent> {
  const params: Stripe.PaymentIntentCreateParams = {
    amount,
    currency,
    automatic_payment_methods: { enabled: true },
    metadata: { order_id: orderId, user_id: userId },
  };

  return stripe.paymentIntents.create(params, {
    idempotencyKey: buildPaymentIntentIdempotencyKey(orderId, amount, currency),
  });
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const { orderId } = await req.json().catch(() => ({}));
    if (!orderId) return json({ error: "orderId is required" }, 400);

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select(
        "id, created_by, client_user_id, total, total_cents, grand_total, currency, payment_status, stripe_payment_intent_id"
      )
      .eq("id", orderId)
      .single();

    if (orderErr || !order) return json({ error: "Order not found" }, 404);

    const ownerId = order.client_user_id ?? order.created_by;
    if (ownerId !== userData.user.id) return json({ error: "Forbidden" }, 403);

    if (String(order.payment_status ?? "").toLowerCase() === "paid") {
      return json({ error: "Order already paid", alreadyPaid: true }, 409);
    }

    const amount = resolveOrderAmountCents(order);
    if (amount == null) return json({ error: "Invalid order total" }, 400);

    const currency = (order.currency || "USD").toLowerCase();

    let paymentIntent: Stripe.PaymentIntent;

    if (order.stripe_payment_intent_id) {
      paymentIntent = await stripe.paymentIntents.retrieve(
        order.stripe_payment_intent_id
      );

      if (paymentIntent.status === "succeeded") {
        return json({
          ok: true,
          alreadyPaid: true,
          paymentIntentId: paymentIntent.id,
          clientSecret: null,
          message:
            "Payment already succeeded — sync via confirm-paid or webhook.",
        });
      }

      const finalStates = ["canceled"] as const;
      if (finalStates.includes(paymentIntent.status as "canceled")) {
        paymentIntent = await createOrderPaymentIntent(
          order.id,
          userData.user.id,
          amount,
          currency,
        );
      } else if (
        paymentIntent.amount !== amount ||
        paymentIntent.currency !== currency
      ) {
        paymentIntent = await createOrderPaymentIntent(
          order.id,
          userData.user.id,
          amount,
          currency,
        );
      }
    } else {
      paymentIntent = await createOrderPaymentIntent(
        order.id,
        userData.user.id,
        amount,
        currency,
      );
    }

    const { error: updErr } = await supabase
      .from("orders")
      .update({
        stripe_payment_intent_id: paymentIntent.id,
        payment_status: "requires_payment",
      })
      .eq("id", order.id);

    if (updErr) return json({ error: "Failed to update order" }, 500);

    return json({
      ok: true,
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.log("create_payment_intent error:", message);
    return json({ error: "payment_setup_failed" }, 500);
  }
});
