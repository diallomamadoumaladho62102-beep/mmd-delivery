import { buildCorsHeaders } from "../_shared/cors.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getEdgeSecretKey,
  getEdgeSupabaseUrl,
} from "../_shared/supabaseKeys.ts";


const SUPABASE_URL = getEdgeSupabaseUrl();
const SUPABASE_SERVICE_ROLE_KEY = getEdgeSecretKey();
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY")!;
const CRON_SECRET = Deno.env.get("CRON_SECRET")!;

function json(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" },
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
    const msg = out?.error?.message || out?.message || `Stripe error (${res.status})`;
    throw new Error(msg);
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: buildCorsHeaders(req) });

  if (Deno.env.get("MMD_EDGE_PAYOUTS_DISABLED") === "true") {
    return json(req, {
      ok: true,
      disabled: true,
      handler: "vercel",
      path: "/api/admin/process-payouts",
    });
  }

  try {
    if (req.method !== "POST") return json(req, { error: "Use POST" }, 405);

    // secret header
    const secret = req.headers.get("x-cron-secret") ?? "";
    if (!CRON_SECRET || secret !== CRON_SECRET) {
      return json(req, { error: "Forbidden" }, 403);
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Trouver tous les restaurants avec stripe_account_id
    const { data: restaurants, error: rErr } = await admin
      .from("restaurant_profiles")
      .select("user_id, stripe_account_id")
      .not("stripe_account_id", "is", null);

    if (rErr) throw rErr;

    const results: any[] = [];

    for (const r of restaurants ?? []) {
      const restaurant_user_id = String((r as any).user_id);
      const stripeAccountId = String((r as any).stripe_account_id);

      // Unpaid delivered orders
      const { data: orders, error: oErr } = await admin
        .from("orders")
        .select("id, currency, restaurant_net_amount, restaurant_paid_out")
        .eq("status", "delivered")
        .eq("restaurant_id", restaurant_user_id)
        .or("restaurant_paid_out.is.null,restaurant_paid_out.eq.false");

      if (oErr) throw oErr;

      const currency = (orders?.find((o: any) => o.currency)?.currency ?? "USD") as string;

      const amount = (orders ?? []).reduce((acc: number, o: any) => {
        const v = Number(o.restaurant_net_amount ?? 0);
        return acc + (Number.isFinite(v) ? v : 0);
      }, 0);

      const amountCents = Math.round(amount * 100);

      if (!orders || orders.length === 0 || amountCents <= 0) {
        results.push({ restaurant_user_id, ok: true, message: "Nothing to payout" });
        continue;
      }

      // Create payout row
      const { data: payout, error: pErr } = await admin
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

      if (pErr) throw pErr;

      const transfer = await stripePOST(
        "transfers",
        {
          amount: String(amountCents),
          currency: currency.toLowerCase(),
          destination: stripeAccountId,
          "metadata[payout_id]": String((payout as any).id),
          "metadata[restaurant_user_id]": restaurant_user_id,
        },
        String((payout as any).id)
      );

      const transferId = String((transfer as any).id);
      const now = new Date().toISOString();

      const orderIds = (orders ?? []).map((o: any) => o.id);

      const { error: updOrdersErr } = await admin
        .from("orders")
        .update({
          restaurant_paid_out: true,
          restaurant_paid_out_at: now,
          restaurant_transfer_id: transferId,
          restaurant_payout_id: (payout as any).id,
        })
        .in("id", orderIds);

      if (updOrdersErr) throw updOrdersErr;

      const { error: updPayErr } = await admin
        .from("restaurant_payouts")
        .update({
          status: "paid",
          stripe_transfer_id: transferId,
          paid_at: now,
        })
        .eq("id", (payout as any).id);

      if (updPayErr) throw updPayErr;

      results.push({
        restaurant_user_id,
        ok: true,
        amount_cents: amountCents,
        stripe_transfer_id: transferId,
        orders_count: orderIds.length,
        payout_id: (payout as any).id,
      });
    }

    return json(req, { ok: true, results });
  } catch (e: any) {
    console.log("pay_restaurant_scheduled error:", e?.message ?? e);
    return json(req, { error: e?.message ?? "Unknown error" }, 500);
  }
});
