// supabase/functions/restaurant-connect-link/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getEdgePublishableKey,
  getEdgeSecretKey,
  getEdgeSupabaseUrl,
} from "../_shared/supabaseKeys.ts";

// --- CORS ---
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --- ENV ---
const SUPABASE_URL = getEdgeSupabaseUrl();
const SUPABASE_ANON_KEY = getEdgePublishableKey();
const SUPABASE_SERVICE_ROLE_KEY = getEdgeSecretKey();
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

// ⚠️ Stripe Account Links préfère des URLs web (https://...)
const DEFAULT_RETURN_URL =
  Deno.env.get("STRIPE_RETURN_URL") ?? "https://www.mmddelivery.com/stripe/return";
const DEFAULT_REFRESH_URL =
  Deno.env.get("STRIPE_REFRESH_URL") ?? "https://www.mmddelivery.com/stripe/refresh";

function assertStripeConnectSecretOrThrow() {
  if (!STRIPE_SECRET_KEY) {
    throw new Error("Missing STRIPE_SECRET_KEY");
  }
  const allowTest =
    String(Deno.env.get("STRIPE_ALLOW_TEST_CONNECT") ?? "")
      .trim()
      .toLowerCase() === "true";
  if (!STRIPE_SECRET_KEY.startsWith("sk_live_") && !allowTest) {
    throw new Error(
      "stripe_secret_key_must_be_live: set Supabase STRIPE_SECRET_KEY to sk_live_* " +
        "(or STRIPE_ALLOW_TEST_CONNECT=true for non-production only)",
    );
  }
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isValidHttpUrl(v: string) {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

// Si on reçoit mmd://... (deep link), Stripe risque de refuser.
// On remplace par une URL web safe.
function normalizeStripeUrl(input: string, fallback: string) {
  const v = String(input ?? "").trim();
  if (!v) return fallback;

  // Stripe: préfère https/http, deep links souvent refusés
  if (isValidHttpUrl(v)) return v;

  console.log("normalizeStripeUrl: non-http url rejected by Stripe:", v);
  return fallback;
}

async function stripePOST(path: string, body: Record<string, string>) {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) form.append(k, v);

  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return json({ error: "Use POST" }, 405);
    }

    assertStripeConnectSecretOrThrow();

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

    // --- Body ---
    let body: any = {};
    try {
      body = await req.json();
    } catch {}

    // ✅ Normalisation URLs (évite erreur Stripe avec mmd://...)
    const return_url = normalizeStripeUrl(
      String(body?.return_url ?? ""),
      DEFAULT_RETURN_URL
    );
    const refresh_url = normalizeStripeUrl(
      String(body?.refresh_url ?? ""),
      DEFAULT_REFRESH_URL
    );

    console.log("restaurant-connect-link: user", userId);
    console.log("restaurant-connect-link: return_url", return_url);
    console.log("restaurant-connect-link: refresh_url", refresh_url);

    // --- DB (service role) ---
    const supabaseAdmin = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    // 1) Charger le restaurant profile via user_id
    const { data: profile, error: profErr } = await supabaseAdmin
      .from("restaurant_profiles")
      .select(
        `
        user_id,
        stripe_account_id,
        stripe_onboarding_status,
        stripe_charges_enabled,
        stripe_payouts_enabled,
        stripe_details_submitted
      `
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (profErr) throw profErr;
    if (!profile) {
      return json(
        { error: "Restaurant profile introuvable pour cet utilisateur." },
        404
      );
    }

    let stripeAccountId = profile.stripe_account_id as string | null;

    // 2) Recreate if DB still points at a test-mode acct_ after switching to sk_live_
    if (stripeAccountId) {
      const getRes = await fetch(
        `https://api.stripe.com/v1/accounts/${encodeURIComponent(stripeAccountId)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
        },
      );
      if (!getRes.ok) {
        console.log(
          "restaurant-connect-link: clearing stale stripe_account_id",
          stripeAccountId,
        );
        await supabaseAdmin
          .from("restaurant_profiles")
          .update({
            stripe_account_id: null,
            stripe_onboarding_status: "pending",
          })
          .eq("user_id", userId);
        stripeAccountId = null;
      }
    }

    if (!stripeAccountId) {
      const acct = await stripePOST("accounts", {
        type: "express",
        country: "US",
        "capabilities[card_payments][requested]": "true",
        "capabilities[transfers][requested]": "true",
        "metadata[supabase_user_id]": userId,
      });

      stripeAccountId = acct.id as string;

      const { error: upErr } = await supabaseAdmin
        .from("restaurant_profiles")
        .update({
          stripe_account_id: stripeAccountId,
          stripe_onboarding_status: "created",
        })
        .eq("user_id", userId);

      if (upErr) throw upErr;
    }

    // 3) Lien Stripe onboarding
    const link = await stripePOST("account_links", {
      account: stripeAccountId,
      refresh_url,
      return_url,
      type: "account_onboarding",
    });

    return json({
      url: link.url,
      stripe_account_id: stripeAccountId,
    });
  } catch (e: any) {
    console.log("restaurant-connect-link error:", e);
    return json({ error: e?.message ?? "Unknown error" }, 500);
  }
});
