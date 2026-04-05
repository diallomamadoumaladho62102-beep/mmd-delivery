import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno&deno-std=0.224.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

    if (!supabaseUrl || !supabaseAnon || !supabaseService) {
      return new Response(JSON.stringify({ error: "Missing Supabase env vars" }), { status: 500 });
    }
    if (!stripeKey) {
      return new Response(JSON.stringify({ error: "Missing STRIPE_SECRET_KEY" }), { status: 500 });
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Auth user (JWT venant du mobile)
    const supabaseAuth = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });

    const { data: userData, error: uErr } = await supabaseAuth.auth.getUser();
    if (uErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Not authenticated", details: uErr?.message }), { status: 401 });
    }

    const userId = userData.user.id;

    const supabase = createClient(supabaseUrl, supabaseService);

    // Lire stripe_account_id
    const { data: prof, error: pErr } = await supabase
      .from("driver_profiles")
      .select("stripe_account_id, stripe_onboarded")
      .eq("user_id", userId)
      .maybeSingle();

    if (pErr) {
      return new Response(JSON.stringify({ error: "Profile read failed", details: pErr.message }), { status: 400 });
    }

    const accountId = (prof as any)?.stripe_account_id ?? null;

    // ✅ IMPORTANT: si Stripe n'est pas encore configuré, on répond 200 (pas d'erreur non-2xx)
    if (!accountId) {
      return new Response(
        JSON.stringify({
          stripe_account_id: null,
          stripe_onboarded: false,
          details_submitted: false,
          charges_enabled: false,
          payouts_enabled: false,
          status: "not_started",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // Vérifier status Stripe
    const acct = await stripe.accounts.retrieve(accountId);

    const detailsSubmitted = Boolean((acct as any)?.details_submitted);
    const chargesEnabled = Boolean((acct as any)?.charges_enabled);
    const payoutsEnabled = Boolean((acct as any)?.payouts_enabled);

    // ✅ Règle “onboarded” (tu peux ajuster)
    const onboarded = detailsSubmitted || payoutsEnabled || chargesEnabled;

    if (onboarded) {
      const { error: upErr } = await supabase
        .from("driver_profiles")
        .update({
          stripe_onboarded: true,
          stripe_onboarded_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      if (upErr) {
        return new Response(JSON.stringify({ error: "Profile update failed", details: upErr.message }), { status: 400 });
      }
    }

    return new Response(
      JSON.stringify({
        stripe_account_id: accountId,
        stripe_onboarded: onboarded,
        details_submitted: detailsSubmitted,
        charges_enabled: chargesEnabled,
        payouts_enabled: payoutsEnabled,
        status: onboarded ? "connected" : "pending",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? "Server error" }), { status: 500 });
  }
});
