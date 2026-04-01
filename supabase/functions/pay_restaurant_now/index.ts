import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function stripePOST(
  path: string,
  body: Record<string, string>,
  idempotencyKey?: string
) {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) form.append(k, v);

  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: form.toString(),
  });

  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      out?.error?.message || out?.message || `Stripe error (${res.status})`;
    throw new Error(msg);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "Use POST" }, 405);

    // --- Auth user (Bearer JWT) ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    if (!token) return json({ error: "Missing Authorization Bearer token" }, 401);

    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Unauthorized" }, 401);
    const callerUserId = userData.user.id;

    // --- Admin client ---
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Check admin permission
    const { data: adminRow, error: adminErr } = await admin
      .from("admin_users")
      .select("user_id")
      .eq("user_id", callerUserId)
      .maybeSingle();

    if (adminErr) throw adminErr;
    if (!adminRow) return json({ error: "Forbidden (admin only)" }, 403);

    // --- Body: restaurant_user_id (optionnel) ---
    let body: any = {};
    try {
      body = await req.json();
    } catch {}

    const restaurant_user_id = String(body?.restaurant_user_id ?? "");
    if (!restaurant_user_id) {
      return json({ error: "Missing restaurant_user_id" }, 400);
    }

    // Load restaurant profile (Connect account)
    const { data: profile, error: profErr } = await admin
      .from("restaurant_profiles")
      .select("user_id, stripe_account_id")
      .eq("user_id", restaurant_user_id)
      .maybeSingle();

    if (profErr) throw profErr;
    if (!profile?.stripe_account_id) {
      return json({ error: "No stripe_account_id for this restaurant" }, 400);
    }

    const stripeAccountId = String(profile.stripe_account_id);

    // Get unpaid delivered orders
    const { data: orders, error: ordersErr } = await admin
      .from("orders")
      .select("id, currency, restaurant_net_amount, restaurant_paid_out")
      .eq("status", "delivered")
      .eq("restaurant_id", restaurant_user_id) // ⚠️ chez toi restaurant_id = RESTAURANT_ID (user_id)
      .or("restaurant_paid_out.is.null,restaurant_paid_out.eq.false");

    if (ordersErr) throw ordersErr;

    const currency = (orders?.find((o: any) => o.currency)?.currency ?? "USD") as string;

    const amount = (orders ?? []).reduce((acc: number, o: any) => {
      const v = Number(o.restaurant_net_amount ?? 0);
      return acc + (Number.isFinite(v) ? v : 0);
    }, 0);

    const amountCents = Math.round(amount * 100);

    if (!orders || orders.length === 0 || amountCents <= 0) {
      return json({
        ok: true,
        message: "Nothing to payout",
        restaurant_user_id,
        stripe_account_id: stripeAccountId,
        amount_cents: 0,
      });
    }

    // Create payout row (pending)
    const { data: payout, error: payInsErr } = await admin
      .from("restaurant_payouts")
      .insert({
        restaurant_user_id,
        stripe_account_id: stripeAccountId,
        currency,
        amount_cents: amountCents,
        status: "pending",
      })
      .select("*")
      .single();

    if (payInsErr) throw payInsErr;

    // Stripe transfer (REAL MONEY)
    const transfer = await stripePOST(
      "transfers",
      {
        amount: String(amountCents),
        currency: currency.toLowerCase(),
        destination: stripeAccountId,
        "metadata[payout_id]": String(payout.id),
        "metadata[restaurant_user_id]": restaurant_user_id,
      },
      String(payout.id) // idempotency
    );

    const transferId = String(transfer.id);

    // Mark orders paid_out + link payout/transfer
    const now = new Date().toISOString();

    const orderIds = (orders ?? []).map((o: any) => o.id);

    const { error: updOrdersErr } = await admin
      .from("orders")
      .update({
        restaurant_paid_out: true,
        restaurant_paid_out_at: now,
        restaurant_transfer_id: transferId,
        restaurant_payout_id: payout.id,
      })
      .in("id", orderIds);

    if (updOrdersErr) throw updOrdersErr;

    // Update payout row -> paid
    const { error: updPayErr } = await admin
      .from("restaurant_payouts")
      .update({
        status: "paid",
        stripe_transfer_id: transferId,
        paid_at: now,
      })
      .eq("id", payout.id);

    if (updPayErr) throw updPayErr;

    return json({
      ok: true,
      restaurant_user_id,
      stripe_account_id: stripeAccountId,
      currency,
      amount_cents: amountCents,
      stripe_transfer_id: transferId,
      orders_count: orderIds.length,
      payout_id: payout.id,
    });
  } catch (e: any) {
    console.log("pay_restaurant_now error:", e?.message ?? e);

    // best-effort: si payout pending existe, on pourrait le marquer failed (ici on garde simple)
    return json({ error: e?.message ?? "Unknown error" }, 500);
  }
});
