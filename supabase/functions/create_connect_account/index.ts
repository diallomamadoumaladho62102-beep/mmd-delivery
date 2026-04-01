import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno&deno-std=0.224.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

type Json = Record<string, unknown>;

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getAuthHeader(req: Request) {
  // Certains clients envoient "Authorization" ou "authorization"
  return req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
}

serve(async (req) => {
  // CORS preflight
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
    const returnUrl = Deno.env.get("STRIPE_RETURN_URL") ?? "";
    const refreshUrl = Deno.env.get("STRIPE_REFRESH_URL") ?? "";

    if (!supabaseUrl || !supabaseAnon || !supabaseService) {
      return json({ error: "Missing Supabase env vars (SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY)" }, 500);
    }
    if (!stripeKey) {
      return json({ error: "Missing STRIPE_SECRET_KEY" }, 500);
    }
    if (!returnUrl || !refreshUrl) {
      return json({ error: "Missing STRIPE_RETURN_URL / STRIPE_REFRESH_URL" }, 500);
    }

    const authHeader = getAuthHeader(req);
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing Authorization Bearer token" }, 401);
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
      // ✅ indispensable dans Supabase Edge
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Auth user (token du mobile) -> on valide qui appelle
    const supabaseAuth = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userData, error: uErr } = await supabaseAuth.auth.getUser();
    if (uErr || !userData?.user) {
      return json({ error: "Not authenticated", details: uErr?.message ?? null }, 401);
    }

    const userId = userData.user.id;

    const body = await req.json().catch(() => ({} as any));
    const role = body?.role;

    if (role !== "driver" && role !== "restaurant") {
      return json({ error: "Invalid role. Must be 'driver' or 'restaurant'." }, 400);
    }

    // Service role client (bypass RLS)
    const supabase = createClient(supabaseUrl, supabaseService, {
      auth: { persistSession: false },
    });

    const table = role === "driver" ? "driver_profiles" : "restaurant_profiles";

    // Lire profil
    const { data: prof, error: pErr } = await supabase
      .from(table)
      .select("stripe_account_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (pErr) {
      return json({ error: "Profile read failed", details: pErr.message }, 400);
    }

    let accountId: string | null = (prof as any)?.stripe_account_id ?? null;

    // Créer le compte Stripe si absent
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        // Recommandé: transfers + card_payments
        capabilities: {
          transfers: { requested: true },
          card_payments: { requested: true },
        },
        metadata: { user_id: userId, role },
      });

      accountId = account.id;

      const { error: upErr } = await supabase
        .from(table)
        .update({ stripe_account_id: accountId })
        .eq("user_id", userId);

      if (upErr) {
        return json({ error: "Profile update failed", details: upErr.message }, 400);
      }
    }

    // Générer le lien d'onboarding
    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding",
    });

    return json({
      ok: true,
      role,
      user_id: userId,
      account_id: accountId,
      onboarding_url: link.url,
      expires_at: link.expires_at ?? null,
    });
  } catch (e: any) {
    console.error("create_connect_account fatal:", e);
    return json({ error: e?.message ?? "Server error" }, 500);
  }
});
