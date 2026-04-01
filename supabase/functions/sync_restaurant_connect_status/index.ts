// supabase/functions/sync_restaurant_connect_status/index.ts
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

async function stripeGET(path: string) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    },
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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Use POST" }, 405);
    }

    // --- Auth ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return json({ error: "Missing Authorization Bearer token" }, 401);
    }

    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } =
      await supabaseAuth.auth.getUser();

    if (userErr || !userData?.user) {
      return json({ error: "Unauthorized" }, 401);
    }

    const userId = userData.user.id;

    // --- Admin client ---
    const supabaseAdmin = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    // 1) Lire restaurant_profiles
    const { data: profile, error: profErr } = await supabaseAdmin
      .from("restaurant_profiles")
      .select("user_id, stripe_account_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (profErr) throw profErr;
    if (!profile) {
      return json({ error: "Restaurant profile not found" }, 404);
    }

    const stripeAccountId = profile.stripe_account_id as string | null;
    if (!stripeAccountId) {
      return json({ error: "No stripe_account_id for this restaurant" }, 400);
    }

    // 2) Lire le compte Stripe
    const acct = await stripeGET(`accounts/${stripeAccountId}`);

    const chargesEnabled = Boolean(acct?.charges_enabled);
    const payoutsEnabled = Boolean(acct?.payouts_enabled);
    const detailsSubmitted = Boolean(acct?.details_submitted);

    // 3) Déduire le statut
    const onboardingStatus = payoutsEnabled
      ? "active"
      : detailsSubmitted
      ? "submitted"
      : "pending";

    // 4) Update DB
    const updatePayload: Record<string, any> = {
      stripe_charges_enabled: chargesEnabled,
      stripe_payouts_enabled: payoutsEnabled,
      stripe_details_submitted: detailsSubmitted,
      stripe_onboarding_status: onboardingStatus,
    };

    if (payoutsEnabled) {
      updatePayload.stripe_onboarded = true;
      updatePayload.stripe_onboarded_at = new Date().toISOString();
    }

    const { error: upErr } = await supabaseAdmin
      .from("restaurant_profiles")
      .update(updatePayload)
      .eq("user_id", userId);

    if (upErr) throw upErr;

    return json({
      stripe_account_id: stripeAccountId,
      stripe_charges_enabled: chargesEnabled,
      stripe_payouts_enabled: payoutsEnabled,
      stripe_details_submitted: detailsSubmitted,
      stripe_onboarding_status: onboardingStatus,
    });
  } catch (e: any) {
    console.log("sync_restaurant_connect_status error:", e);
    return json({ error: e?.message ?? "Unknown error" }, 500);
  }
});
