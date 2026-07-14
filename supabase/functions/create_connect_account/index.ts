import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno&deno-std=0.224.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";
import {
  getEdgePublishableKeyOptional,
  getEdgeSecretKeyOptional,
  getEdgeSupabaseUrl,
} from "../_shared/supabaseKeys.ts";

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

function normalizeStripeConnectCountry(value: unknown): string {
  const raw = String(value ?? "").trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  if (raw === "USA" || raw === "UNITED STATES") return "US";
  if (raw === "CANADA") return "CA";
  if (raw === "UNITED KINGDOM" || raw === "UK") return "GB";
  if (raw === "FRANCE") return "FR";
  if (raw === "BELGIUM") return "BE";
  if (raw === "GUINEA" || raw === "GUINEE") return "GN";
  if (raw === "SENEGAL") return "SN";
  if (raw === "COTE D IVOIRE" || raw === "CÔTE D'IVOIRE" || raw === "IVORY COAST") return "CI";
  if (raw === "MALI") return "ML";
  if (raw === "SIERRA LEONE") return "SL";
  if (raw === "MAURITANIA") return "MR";
  return "US";
}

function inferConnectCountryFromProfile(city: unknown, state: unknown): string {
  const cityText = String(city ?? "").trim().toUpperCase();
  if (cityText.includes("CONAKRY") || cityText.includes("GUINE")) return "GN";
  if (cityText.includes("DAKAR") || cityText.includes("SENEGAL")) return "SN";
  if (cityText.includes("ABIDJAN") || cityText.includes("IVOIRE")) return "CI";
  if (cityText.includes("BAMAKO") || cityText.includes("MALI")) return "ML";
  if (cityText.includes("FREETOWN") || cityText.includes("SIERRA")) return "SL";
  if (cityText.includes("NOUAKCHOTT") || cityText.includes("MAURITAN")) return "MR";
  return normalizeStripeConnectCountry(state);
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

    let supabaseUrl = "";
    try {
      supabaseUrl = getEdgeSupabaseUrl();
    } catch {
      supabaseUrl = "";
    }
    const supabaseAnon = getEdgePublishableKeyOptional();
    const supabaseService = getEdgeSecretKeyOptional();
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
    const returnUrl = Deno.env.get("STRIPE_RETURN_URL") ?? "";
    const refreshUrl = Deno.env.get("STRIPE_REFRESH_URL") ?? "";

    if (!supabaseUrl || !supabaseAnon || !supabaseService) {
      return json({ error: "Missing Supabase env vars" }, 500);
    }
    if (!stripeKey) {
      return json({ error: "Missing STRIPE_SECRET_KEY" }, 500);
    }
    if (!returnUrl || !refreshUrl) {
      return json({ error: "Missing STRIPE_RETURN_URL / STRIPE_REFRESH_URL" }, 500);
    }

    // Fail-closed: Connect onboarding mode follows STRIPE_SECRET_KEY.
    // sk_test_ produces Stripe-hosted "TEST BANK" UI — refuse unless explicitly allowed.
    const allowTestConnect =
      String(Deno.env.get("STRIPE_ALLOW_TEST_CONNECT") ?? "")
        .trim()
        .toLowerCase() === "true";
    const stripeMode = stripeKey.startsWith("sk_live_")
      ? "live"
      : stripeKey.startsWith("sk_test_")
        ? "test"
        : "unknown";
    if (stripeMode !== "live" && !allowTestConnect) {
      return json(
        {
          error: "stripe_secret_key_must_be_live",
          message:
            "Connect onboarding requires Supabase secret STRIPE_SECRET_KEY=sk_live_*. " +
            "Set STRIPE_ALLOW_TEST_CONNECT=true only for non-production Edge testing.",
          stripe_mode: stripeMode,
        },
        500,
      );
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
      .select("stripe_account_id, city, state")
      .eq("user_id", userId)
      .maybeSingle();

    if (pErr) {
      return json({ error: "Profile read failed", details: pErr.message }, 400);
    }

    let accountId: string | null = (prof as any)?.stripe_account_id ?? null;
    let clearedStaleTestAccount = false;

    const connectCountry = normalizeStripeConnectCountry(
      body?.country_code ??
        body?.countryCode ??
        inferConnectCountryFromProfile((prof as any)?.city, (prof as any)?.state)
    );

    // If DB still holds a test-mode acct_ after switching to sk_live_, retrieve fails —
    // clear and recreate under Live so onboarding never reuses a test Connect account.
    if (accountId) {
      try {
        await stripe.accounts.retrieve(accountId);
      } catch (retrieveErr: any) {
        console.error(
          "create_connect_account: stale stripe_account_id, clearing for recreate:",
          accountId,
          retrieveErr?.message ?? retrieveErr,
        );
        const clearPayload =
          role === "driver"
            ? { stripe_account_id: null, stripe_onboarded: false }
            : {
                stripe_account_id: null,
                stripe_onboarding_status: "pending",
                stripe_onboarded: false,
              };
        const { error: clearErr } = await supabase
          .from(table)
          .update(clearPayload)
          .eq("user_id", userId);
        if (clearErr) {
          return json(
            {
              error: "Failed to clear stale Stripe Connect account id",
              details: clearErr.message,
            },
            400,
          );
        }
        accountId = null;
        clearedStaleTestAccount = true;
      }
    }

    // Créer le compte Stripe si absent
    if (!accountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: connectCountry,
        // Recommandé: transfers + card_payments
        capabilities: {
          transfers: { requested: true },
          card_payments: { requested: true },
        },
        metadata: { user_id: userId, role, country: connectCountry },
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
      country: connectCountry,
      onboarding_url: link.url,
      expires_at: link.expires_at ?? null,
      stripe_mode: stripeMode,
      cleared_stale_test_account: clearedStaleTestAccount,
    });
  } catch (e: any) {
    console.error("create_connect_account fatal:", e);
    return json({ error: e?.message ?? "Server error" }, 500);
  }
});
