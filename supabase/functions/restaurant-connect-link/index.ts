// supabase/functions/restaurant-connect-link/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  getEdgePublishableKey,
  getEdgeSecretKey,
  getEdgeSupabaseUrl,
} from "../_shared/supabaseKeys.ts";
import { buildCorsHeaders } from "../_shared/cors.ts";
import { resolveStripeConnectCountry } from "../_shared/stripeConnectCountry.ts";


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

function json(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" },
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

type RestaurantProfileRow = {
  user_id: string;
  stripe_account_id: string | null;
  stripe_onboarding_status?: string | null;
  stripe_charges_enabled?: boolean | null;
  stripe_payouts_enabled?: boolean | null;
  stripe_details_submitted?: boolean | null;
  city?: string | null;
  state?: string | null;
  country_code?: string | null;
  country?: string | null;
};

/** Select city/state/country_code when present; fall back if columns missing. */
async function loadRestaurantProfile(
  supabaseAdmin: ReturnType<typeof createClient>,
  userId: string,
): Promise<{ data: RestaurantProfileRow | null; error: { message: string } | null }> {
  const base =
    "user_id, stripe_account_id, stripe_onboarding_status, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted";
  const attempts = [
    `${base}, city, state, country_code`,
    `${base}, city, state`,
    `${base}, city, country_code`,
    base,
  ];

  let lastErr: { message: string } | null = null;
  for (const select of attempts) {
    const { data, error } = await supabaseAdmin
      .from("restaurant_profiles")
      .select(select)
      .eq("user_id", userId)
      .maybeSingle();

    if (!error) {
      return { data: (data as RestaurantProfileRow | null) ?? null, error: null };
    }

    lastErr = error;
    const msg = String(error.message ?? "");
    // Missing column → try narrower select; other errors → stop.
    if (!/column|does not exist|Could not find/i.test(msg)) {
      return { data: null, error };
    }
    console.log(
      "restaurant-connect-link: profile select fallback after",
      select,
      msg,
    );
  }

  return { data: null, error: lastErr };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: buildCorsHeaders(req) });
  }

  try {
    if (req.method !== "POST") {
      return json(req, { error: "Use POST" }, 405);
    }

    assertStripeConnectSecretOrThrow();

    // --- Auth ---
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return json(req, { error: "Missing Authorization Bearer token" }, 401);
    }

    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } =
      await supabaseAuth.auth.getUser();

    if (userErr || !userData?.user) {
      return json(req, { error: "Unauthorized" }, 401);
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
    const { data: profile, error: profErr } = await loadRestaurantProfile(
      supabaseAdmin,
      userId,
    );

    if (profErr) throw profErr;
    if (!profile) {
      return json(req, 
        { error: "Restaurant profile introuvable pour cet utilisateur." },
        404
      );
    }

    const connectCountry = resolveStripeConnectCountry({
      bodyCountryCode: body?.country_code ?? body?.countryCode,
      profileCountryCode: (profile as any)?.country_code,
      city: (profile as any)?.city,
      state: (profile as any)?.state,
      country: (profile as any)?.country,
    });
    console.log("restaurant-connect-link: chosen country", connectCountry, {
      body_country_code: body?.country_code ?? body?.countryCode ?? null,
      profile_country_code: (profile as any)?.country_code ?? null,
      city: (profile as any)?.city ?? null,
      state: (profile as any)?.state ?? null,
    });

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
      const baseAccountBody: Record<string, string> = {
        type: "express",
        country: connectCountry,
        "metadata[supabase_user_id]": userId,
        "metadata[country]": connectCountry,
        // Bank payouts are MMD-scheduled (Sunday 04:00 ET), not Stripe daily auto.
        "settings[payouts][schedule][interval]": "manual",
      };

      let acct;
      try {
        // Prefer transfers + card_payments when the market supports both.
        acct = await stripePOST("accounts", {
          ...baseAccountBody,
          "capabilities[card_payments][requested]": "true",
          "capabilities[transfers][requested]": "true",
        });
      } catch (createErr: any) {
        const createMsg = String(createErr?.message ?? createErr ?? "");
        // Many African Express markets support payouts/transfers without card_payments.
        if (
          /card_payments|capabilities|country.*not.*supported|invalid.*country/i.test(
            createMsg,
          )
        ) {
          console.warn(
            "restaurant-connect-link: retry Express create with transfers-only",
            { country: connectCountry, message: createMsg },
          );
          acct = await stripePOST("accounts", {
            ...baseAccountBody,
            "capabilities[transfers][requested]": "true",
          });
        } else {
          throw createErr;
        }
      }

      stripeAccountId = acct.id as string;

      // Re-assert manual payout schedule (create may ignore nested settings on some markets).
      try {
        await stripePOST(`accounts/${stripeAccountId}`, {
          "settings[payouts][schedule][interval]": "manual",
        });
      } catch (schedErr: any) {
        console.warn(
          "restaurant-connect-link: could not set manual payout schedule",
          schedErr?.message ?? schedErr,
        );
      }

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

    return json(req, {
      url: link.url,
      stripe_account_id: stripeAccountId,
      country: connectCountry,
    });
  } catch (e: any) {
    console.log("restaurant-connect-link error:", e);
    return json(req, { error: e?.message ?? "Unknown error" }, 500);
  }
});
