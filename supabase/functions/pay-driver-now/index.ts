import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno&deno-std=0.224.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

type Json = Record<string, unknown>;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, Authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getAuthHeader(req: Request) {
  return req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
}

function getErrorMessage(e: unknown) {
  if (e instanceof Error && e.message) return e.message;
  return String(e);
}

function isDriverRole(role: string | null | undefined) {
  const normalized = String(role ?? "").trim().toLowerCase();
  return normalized === "driver" || normalized === "livreur";
}

serve(async (req) => {
  if (Deno.env.get("MMD_EDGE_PAYOUTS_DISABLED") === "true") {
    return json({
      ok: false,
      disabled: true,
      message:
        "Edge driver payouts disabled. Use Vercel /api/admin/process-payouts.",
    });
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

    if (!supabaseUrl || !supabaseAnon || !supabaseService) {
      return json(
        {
          error:
            "Missing Supabase env vars (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY)",
        },
        500,
      );
    }

    if (!stripeKey) {
      return json({ error: "Missing STRIPE_SECRET_KEY" }, 500);
    }

    const authHeader = getAuthHeader(req);
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing Authorization Bearer token" }, 401);
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
    if (userErr || !userData?.user) {
      return json(
        { error: "Not authenticated", details: userErr?.message ?? null },
        401,
      );
    }

    const driverUserId = userData.user.id;

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const bodyDriverId = String(body?.driver_id ?? "").trim();

    if (bodyDriverId && bodyDriverId !== driverUserId) {
      return json(
        {
          error: "Forbidden",
          message: "driver_id body parameter is not accepted",
        },
        403,
      );
    }

    const cur = String(body?.currency ?? "USD").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(cur)) {
      return json({ error: "Invalid currency" }, 400);
    }

    if (cur !== "USD") {
      return json({ error: "Unsupported currency" }, 400);
    }

    const supabase = createClient(supabaseUrl, supabaseService, {
      auth: { persistSession: false },
    });

    const { data: profileRow, error: roleErr } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", driverUserId)
      .maybeSingle();

    if (roleErr) {
      return json({ error: "Profile read failed", details: roleErr.message }, 400);
    }

    if (!isDriverRole((profileRow as { role?: string } | null)?.role)) {
      return json({ error: "Forbidden", message: "Driver role required" }, 403);
    }

    const { data: prof, error: profErr } = await supabase
      .from("driver_profiles")
      .select("id, user_id, stripe_account_id, stripe_onboarded")
      .eq("user_id", driverUserId)
      .maybeSingle();

    if (profErr) {
      return json({ error: profErr.message }, 400);
    }

    if (!prof) {
      return json({ error: "Driver profile not found" }, 404);
    }

    if (!prof.stripe_account_id) {
      return json({ error: "Driver has no stripe_account_id" }, 400);
    }

    if (prof.stripe_onboarded === false) {
      return json({ error: "Driver not onboarded" }, 400);
    }

    const { data: prep, error: prepErr } = await supabase.rpc(
      "admin_pay_driver_now",
      {
        p_driver_id: driverUserId,
        p_currency: cur,
      },
    );

    if (prepErr) {
      const message = prepErr.message ?? "Cash out failed";
      if (message.includes("cashout_rate_limited")) {
        return json({ error: message }, 429);
      }
      return json({ error: message }, 400);
    }

    const row = Array.isArray(prep) ? prep[0] : prep;
    const payoutAmount = Number(
      (row as { payout_amount?: unknown } | null)?.payout_amount ?? 0,
    );
    const payoutId = (row as { payout_id?: unknown } | null)?.payout_id;

    if (!payoutId || !Number.isFinite(payoutAmount) || payoutAmount <= 0) {
      return json({
        ok: true,
        message: "Nothing to pay",
        payout_amount: 0,
      });
    }

    const amountCents = Math.round(payoutAmount * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return json({ error: "Invalid payout amount" }, 400);
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const payout = await stripe.payouts.create(
      {
        amount: amountCents,
        currency: cur.toLowerCase(),
        metadata: {
          driver_id: driverUserId,
          driver_profile_id: String(prof.id ?? ""),
          payout_id: String(payoutId),
          source: "mobile_wallet_cashout",
        },
      },
      {
        stripeAccount: prof.stripe_account_id,
        idempotencyKey: `driver-payout:${payoutId}`,
      },
    );

    const { error: finErr } = await supabase.rpc("finalize_driver_payout", {
      p_payout_id: payoutId,
      p_stripe_payout_id: payout.id,
    });

    if (finErr) {
      return json(
        {
          error: "Stripe payout created but DB finalize failed",
          details: finErr.message,
          payout_id: payoutId,
          stripe_payout_id: payout.id,
        },
        500,
      );
    }

    return json({
      ok: true,
      payout_id: payoutId,
      stripe_payout_id: payout.id,
      payout_amount: payoutAmount,
      currency: cur,
      driver_id: driverUserId,
    });
  } catch (e) {
    console.error("[pay-driver-now] fatal:", e);
    return json({ error: getErrorMessage(e) }, 500);
  }
});
