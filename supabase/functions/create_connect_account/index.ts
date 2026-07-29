import { buildCorsHeaders } from "../_shared/cors.ts";
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno&deno-std=0.224.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";
import {
  getEdgePublishableKeyOptional,
  getEdgeSecretKeyOptional,
  getEdgeSupabaseUrl,
} from "../_shared/supabaseKeys.ts";

type Json = Record<string, unknown>;


function json(req: Request, body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...buildCorsHeaders(req), "Content-Type": "application/json" },
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
    return new Response("ok", { headers: buildCorsHeaders(req) });
  }

  try {
    if (req.method !== "POST") {
      return json(req, { error: "Method not allowed" }, 405);
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
    const returnUrl =
      Deno.env.get("STRIPE_RETURN_URL") ?? "https://www.mmddelivery.com/stripe/return";
    const refreshUrl =
      Deno.env.get("STRIPE_REFRESH_URL") ?? "https://www.mmddelivery.com/stripe/refresh";

    if (!supabaseUrl || !supabaseAnon || !supabaseService) {
      return json(req, { error: "Missing Supabase env vars" }, 500);
    }
    if (!stripeKey) {
      return json(req, { error: "Missing STRIPE_SECRET_KEY" }, 500);
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
      return json(req, 
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
      return json(req, { error: "Missing Authorization Bearer token" }, 401);
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
      return json(req, { error: "Not authenticated", details: uErr?.message ?? null }, 401);
    }

    const userId = userData.user.id;

    const body = await req.json().catch(() => ({} as any));
    const roleRaw = String(body?.role ?? "").toLowerCase();
    const role =
      roleRaw === "restaurant"
        ? "restaurant"
        : roleRaw === "seller" || roleRaw === "merchant"
          ? "seller"
          : roleRaw === "driver"
            ? "driver"
            : null;

    if (!role) {
      return json(
        req,
        { error: "Invalid role. Must be 'driver', 'restaurant', or 'seller'." },
        400,
      );
    }

    // Service role client (bypass RLS)
    const supabase = createClient(supabaseUrl, supabaseService, {
      auth: { persistSession: false },
    });

    const table =
      role === "driver"
        ? "driver_profiles"
        : role === "restaurant"
          ? "restaurant_profiles"
          : "sellers";

    // Lire profil
    const selectCols =
      role === "seller"
        ? "stripe_account_id, city, country_code"
        : "stripe_account_id, city, state";
    let { data: prof, error: pErr } = await supabase
      .from(table)
      .select(selectCols)
      .eq("user_id", userId)
      .maybeSingle();

    if (pErr) {
      return json(req, { error: "Profile read failed", details: pErr.message }, 400);
    }

    if (!prof) {
      // Drivers sometimes have profiles.role=driver before driver_profiles exists.
      // Create a minimal row so Connect onboarding can proceed.
      if (role === "driver") {
        const { data: created, error: createProfErr } = await supabase
          .from("driver_profiles")
          .upsert(
            {
              user_id: userId,
              stripe_onboarded: false,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "user_id" },
          )
          .select("stripe_account_id, city, state")
          .maybeSingle();
        if (createProfErr || !created) {
          return json(
            req,
            {
              error: "profile_not_found",
              message:
                "Profile not found for this role. Unable to create driver_profiles row.",
              details: createProfErr?.message ?? null,
            },
            404,
          );
        }
        prof = created;
      } else {
        return json(
          req,
          {
            error: "profile_not_found",
            message:
              role === "seller"
                ? "Complete seller onboarding before connecting Stripe."
                : "Profile not found for this role.",
          },
          404,
        );
      }
    }

    let accountId: string | null = (prof as any)?.stripe_account_id ?? null;
    let clearedStaleTestAccount = false;

    const connectCountry = normalizeStripeConnectCountry(
      body?.country_code ??
        body?.countryCode ??
        (prof as any)?.country_code ??
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
                stripe_charges_enabled: false,
                stripe_payouts_enabled: false,
                stripe_details_submitted: false,
                stripe_onboarded_at: null,
              };
        const { error: clearErr } = await supabase
          .from(table)
          .update(clearPayload)
          .eq("user_id", userId);
        if (clearErr) {
          return json(req, 
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
      const baseAccountParams = {
        type: "express" as const,
        country: connectCountry,
        metadata: { user_id: userId, role, country: connectCountry },
      };

      let account;
      try {
        // Prefer transfers + card_payments when the market supports both.
        account = await stripe.accounts.create({
          ...baseAccountParams,
          capabilities: {
            transfers: { requested: true },
            card_payments: { requested: true },
          },
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
            "create_connect_account: retry Express create with transfers-only",
            { country: connectCountry, message: createMsg },
          );
          account = await stripe.accounts.create({
            ...baseAccountParams,
            capabilities: {
              transfers: { requested: true },
            },
          });
        } else {
          throw createErr;
        }
      }

      accountId = account.id;

      const createPayload =
        role === "driver"
          ? { stripe_account_id: accountId, stripe_onboarded: false }
          : {
              stripe_account_id: accountId,
              stripe_onboarding_status: "created",
              stripe_charges_enabled: false,
              stripe_payouts_enabled: false,
              stripe_details_submitted: false,
            };

      const { error: upErr } = await supabase
        .from(table)
        .update(createPayload)
        .eq("user_id", userId);

      if (upErr) {
        return json(req, { error: "Profile update failed", details: upErr.message }, 400);
      }
    }

    // Sync live Stripe account flags before deciding link type.
    const acct = await stripe.accounts.retrieve(accountId);
    const detailsSubmitted = Boolean(acct.details_submitted);
    const chargesEnabled = Boolean(acct.charges_enabled);
    const payoutsEnabled = Boolean(acct.payouts_enabled);
    const disabledReason =
      (acct.requirements as { disabled_reason?: string | null } | null)
        ?.disabled_reason ?? null;
    const currentlyDue = Array.isArray(acct.requirements?.currently_due)
      ? acct.requirements!.currently_due!
      : [];
    const pastDue = Array.isArray(acct.requirements?.past_due)
      ? acct.requirements!.past_due!
      : [];
    const onboarded = detailsSubmitted && chargesEnabled && payoutsEnabled;
    const nowIso = new Date().toISOString();

    if (role === "driver") {
      await supabase
        .from("driver_profiles")
        .update({
          stripe_onboarded: onboarded,
          stripe_onboarded_at: onboarded ? nowIso : null,
        })
        .eq("user_id", userId);
    } else {
      const statusForDb = onboarded
        ? "ready_for_payouts"
        : pastDue.length > 0
          ? "restricted"
          : detailsSubmitted
            ? "verification_in_progress"
            : "verification_pending";
      await supabase
        .from(table)
        .update({
          stripe_onboarded_at: onboarded ? nowIso : null,
          stripe_charges_enabled: chargesEnabled,
          stripe_payouts_enabled: payoutsEnabled,
          stripe_details_submitted: detailsSubmitted,
          stripe_onboarding_status: statusForDb,
        })
        .eq("user_id", userId);
    }

    // Fully ready: open Express dashboard (bank update / manage) instead of re-onboarding.
    if (onboarded && !disabledReason) {
      const login = await stripe.accounts.createLoginLink(accountId);
      return json(req, {
        ok: true,
        role,
        user_id: userId,
        account_id: accountId,
        country: connectCountry,
        already_complete: true,
        status: "ready_for_payouts",
        status_label: "Ready for payouts",
        can_receive_payouts: true,
        needs_onboarding: false,
        onboarding_url: login.url,
        login_url: login.url,
        stripe_mode: stripeMode,
        cleared_stale_test_account: clearedStaleTestAccount,
        details_submitted: detailsSubmitted,
        charges_enabled: chargesEnabled,
        payouts_enabled: payoutsEnabled,
      });
    }

    // Incomplete or restricted: continue / resume onboarding (or account_update if submitted).
    const linkType =
      detailsSubmitted && (currentlyDue.length > 0 || pastDue.length > 0)
        ? "account_update"
        : "account_onboarding";

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: linkType,
    });

    const status = disabledReason
      ? /rejected|listed|under_review/i.test(disabledReason)
        ? "restricted"
        : "disabled"
      : pastDue.length > 0
        ? "restricted"
        : detailsSubmitted
          ? "verification_in_progress"
          : currentlyDue.length > 0
            ? "verification_pending"
            : "verification_pending";

    return json(req, {
      ok: true,
      role,
      user_id: userId,
      account_id: accountId,
      country: connectCountry,
      already_complete: false,
      status,
      status_label: status.replace(/_/g, " "),
      can_receive_payouts: false,
      needs_onboarding: true,
      onboarding_url: link.url,
      link_type: linkType,
      expires_at: link.expires_at ?? null,
      stripe_mode: stripeMode,
      cleared_stale_test_account: clearedStaleTestAccount,
      details_submitted: detailsSubmitted,
      charges_enabled: chargesEnabled,
      payouts_enabled: payoutsEnabled,
      disabled_reason: disabledReason,
      currently_due: currentlyDue,
      past_due: pastDue,
    });
  } catch (e: any) {
    console.error("create_connect_account fatal:", e);
    const msg = String(e?.raw?.message ?? e?.message ?? "Server error");
    const code = /must be live|sk_live/i.test(msg)
      ? "stripe_secret_key_must_be_live"
      : /complete your platform profile|answer the questionnaire|connect\/accounts\/overview/i.test(
            msg,
          )
        ? "stripe_connect_platform_profile_incomplete"
        : "stripe_connect_error";
    return json(
      req,
      {
        error: code,
        message: msg,
        details: msg,
        stripe_type: typeof e?.type === "string" ? e.type : null,
        stripe_code: typeof e?.code === "string" ? e.code : null,
      },
      500,
    );
  }
});
