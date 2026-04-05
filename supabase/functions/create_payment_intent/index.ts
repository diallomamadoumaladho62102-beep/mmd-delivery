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

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

    // ✅ Auth via JWT Supabase (supabase.functions.invoke envoie Authorization automatiquement)
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const { orderId } = await req.json().catch(() => ({}));
    if (!orderId) return json({ error: "orderId is required" }, 400);

    // ✅ Lire la commande en DB (montant réel calculé depuis la DB, pas depuis le client)
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, created_by, total, currency, payment_status, stripe_payment_intent_id")
      .eq("id", orderId)
      .single();

    if (orderErr || !order) return json({ error: "Order not found" }, 404);
    if (order.created_by !== userData.user.id) return json({ error: "Forbidden" }, 403);

    if (order.payment_status === "paid") {
      return json({ error: "Order already paid" }, 409);
    }

    const currency = (order.currency || "USD").toLowerCase();
    const total = Number(order.total ?? 0);
    if (!Number.isFinite(total) || total <= 0) return json({ error: "Invalid order total" }, 400);

    const amount = Math.round(total * 100); // cents

    // ✅ Reuse PI if exists (sinon create)
    let paymentIntent: Stripe.PaymentIntent;

    if (order.stripe_payment_intent_id) {
      paymentIntent = await stripe.paymentIntents.retrieve(order.stripe_payment_intent_id);

      // Si le PI est dans un état "final", on en recrée un (simple et safe)
      const finalStates = ["succeeded", "canceled"] as const;
      if (finalStates.includes(paymentIntent.status as any)) {
        paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency,
          automatic_payment_methods: { enabled: true },
          metadata: { order_id: order.id, user_id: userData.user.id },
        });
      } else if (paymentIntent.amount !== amount || paymentIntent.currency !== currency) {
        // Si le montant a changé, on recrée (plus simple que update)
        paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency,
          automatic_payment_methods: { enabled: true },
          metadata: { order_id: order.id, user_id: userData.user.id },
        });
      }
    } else {
      paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency,
        automatic_payment_methods: { enabled: true },
        metadata: { order_id: order.id, user_id: userData.user.id },
      });
    }

    // ✅ Enregistrer PI dans orders
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
  } catch (e: any) {
    console.log("create_payment_intent error:", e?.message ?? e);
    return json({ error: e?.message ?? "Server error" }, 500);
  }
});
