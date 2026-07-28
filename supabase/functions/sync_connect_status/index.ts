import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno&deno-std=0.224.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";
import {
  getEdgePublishableKeyOptional,
  getEdgeSecretKeyOptional,
  getEdgeSupabaseUrl,
} from "../_shared/supabaseKeys.ts";

serve(async (req) => {
  try {
    let supabaseUrl = "";
    try {
      supabaseUrl = getEdgeSupabaseUrl();
    } catch {
      supabaseUrl = "";
    }
    const supabaseAnon = getEdgePublishableKeyOptional();
    const supabaseService = getEdgeSecretKeyOptional();
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

    // Auth user (token mobile)
    const supabaseAuth = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });

    const { data: userData, error: uErr } = await supabaseAuth.auth.getUser();
    if (uErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Not authenticated", details: uErr?.message }), { status: 401 });
    }

    const userId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const role = body?.role;

    if (role !== "driver" && role !== "restaurant" && role !== "seller" && role !== "merchant") {
      return new Response(JSON.stringify({ error: "Invalid role" }), { status: 400 });
    }

    const normalizedRole =
      role === "merchant" || role === "seller"
        ? "seller"
        : role === "restaurant"
          ? "restaurant"
          : "driver";

    const supabase = createClient(supabaseUrl, supabaseService);
    const table =
      normalizedRole === "driver"
        ? "driver_profiles"
        : normalizedRole === "restaurant"
          ? "restaurant_profiles"
          : "sellers";

    const { data: prof, error: pErr } = await supabase
      .from(table)
      .select("stripe_account_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (pErr) {
      return new Response(JSON.stringify({ error: "Profile read failed", details: pErr.message }), { status: 400 });
    }

    const accountId = (prof as any)?.stripe_account_id ?? null;
    if (!accountId) {
      return new Response(JSON.stringify({ error: "No stripe_account_id on profile" }), { status: 400 });
    }

    const acct = await stripe.accounts.retrieve(accountId);

    const details_submitted = Boolean((acct as any).details_submitted);
    const charges_enabled = Boolean((acct as any).charges_enabled);
    const payouts_enabled = Boolean((acct as any).payouts_enabled);

    const onboarded = details_submitted && charges_enabled && payouts_enabled;
    const nowIso = new Date().toISOString();

    const updatePayload =
      normalizedRole === "driver"
        ? {
            stripe_onboarded: onboarded,
            stripe_onboarded_at: onboarded ? nowIso : null,
          }
        : {
            stripe_onboarded_at: onboarded ? nowIso : null,
            stripe_charges_enabled: charges_enabled,
            stripe_payouts_enabled: payouts_enabled,
            stripe_details_submitted: details_submitted,
            stripe_onboarding_status: onboarded
              ? "ready_for_payouts"
              : details_submitted
                ? "verification_in_progress"
                : "verification_pending",
          };

    const { error: upErr } = await supabase
      .from(table)
      .update(updatePayload)
      .eq("user_id", userId);

    if (upErr) {
      return new Response(JSON.stringify({ error: "Profile update failed", details: upErr.message }), { status: 400 });
    }

    return new Response(
      JSON.stringify({
        stripe_account_id: accountId,
        stripe_onboarded: onboarded,
        details_submitted,
        charges_enabled,
        payouts_enabled,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message ?? "Server error" }), { status: 500 });
  }
});
