// supabase/functions/confirm_checkout_session/index.ts
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno&deno-std=0.224.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

if (!STRIPE_SECRET_KEY) throw new Error("Missing STRIPE_SECRET_KEY");
if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

// ✅ Deno-friendly Stripe client
const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

type Payload = {
  order_id?: unknown;
  orderId?: unknown;
  session_id?: unknown;
  sessionId?: unknown;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers":
        "authorization, Authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Credentials": "true",
    },
  });
}

function asNonEmptyString(v: unknown) {
  const s = String(v ?? "").trim();
  return s.length ? s : "";
}

function lower(v: unknown) {
  return String(v ?? "").trim().toLowerCase();
}

Deno.serve(async (req: Request) => {
  // ✅ CORS preflight
  if (req.method === "OPTIONS") return json(200, { ok: true });

  try {
    if (req.method !== "POST") return json(405, { error: "Method Not Allowed" });

    const payload = (await req.json().catch(() => ({}))) as Payload;

    const order_id = asNonEmptyString(payload.order_id ?? payload.orderId);
    const session_id = asNonEmptyString(payload.session_id ?? payload.sessionId);

    if (!order_id || !session_id) {
      return json(400, { error: "Missing order_id or session_id" });
    }

    // Admin client (bypass RLS server-side)
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Retrieve Stripe checkout session (expand payment_intent)
    const session = await stripe.checkout.sessions.retrieve(session_id, {
      expand: ["payment_intent"],
    });

    const paymentStatus = lower(session.payment_status); // paid | unpaid | no_payment_required
    const sessionStatus = lower(session.status); // complete | open | expired | etc.
    const isPaid = paymentStatus === "paid" || paymentStatus === "no_payment_required";

    const pi = session.payment_intent;
    const piId =
      typeof pi === "string"
        ? pi
        : pi && typeof pi === "object" && "id" in pi
          ? String((pi as Stripe.PaymentIntent).id)
          : null;

    // ✅ Sécurité: s'assurer que la session correspond à la commande
    const ref = asNonEmptyString(session.client_reference_id);

    const metaOrder =
      asNonEmptyString(session.metadata?.order_id) ||
      asNonEmptyString(session.metadata?.orderId);

    const matchesOrder = ref === order_id || metaOrder === order_id;
    if (!matchesOrder) {
      return json(400, {
        error: "Session does not match order_id",
        details: {
          order_id,
          client_reference_id: ref || null,
          metadata_order_id: metaOrder || null,
        },
      });
    }

    const nowIso = new Date().toISOString();

    // ✅ Paid -> mark paid (idempotent)
    if (isPaid) {
      const { data: updated, error: upErr } = await admin
        .from("orders")
        .update({
          payment_status: "paid",
          paid_at: nowIso,
          stripe_session_id: session_id,
          stripe_payment_intent_id: piId,
          updated_at: nowIso,
        })
        .eq("id", order_id)
        .neq("payment_status", "paid")
        .select("id, payment_status, paid_at")
        .maybeSingle();

      if (upErr) return json(500, { error: upErr.message });

      return json(200, {
        ok: true,
        paid: true,
        payment_status: paymentStatus || null,
        session_status: sessionStatus || null,
        payment_intent_id: piId,
        updated: Boolean(updated),
      });
    }

    // ✅ Not paid yet
    // Si session expired/canceled -> remettre unpaid (évite rester bloqué processing)
    if (sessionStatus === "expired" || sessionStatus === "canceled") {
      const { error: resetErr } = await admin
        .from("orders")
        .update({
          payment_status: "unpaid",
          stripe_session_id: session_id,
          stripe_payment_intent_id: piId,
          updated_at: nowIso,
        })
        .eq("id", order_id);

      if (resetErr) {
        console.error("[confirm_checkout_session] reset unpaid failed:", resetErr.message);
      }
    } else {
      // session open/complete mais pas paid -> stocker quand même
      const { error: storeErr } = await admin
        .from("orders")
        .update({
          stripe_session_id: session_id,
          stripe_payment_intent_id: piId,
          updated_at: nowIso,
        })
        .eq("id", order_id);

      if (storeErr) {
        console.error("[confirm_checkout_session] store session id failed:", storeErr.message);
      }
    }

    return json(200, {
      ok: true,
      paid: false,
      payment_status: paymentStatus || null,
      session_status: sessionStatus || null,
      payment_intent_id: piId,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e ?? "Server error");
    console.error("[confirm_checkout_session] error:", msg);
    return json(500, { error: msg });
  }
});