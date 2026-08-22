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

/** ISO countries we intentionally support for Express Connect (not US states). */
const STRIPE_CONNECT_COUNTRIES = new Set([
  "US",
  "CA",
  "GB",
  "FR",
  "BE",
  "GN",
  "SN",
  "CI",
  "ML",
  "SL",
  "MR",
  "DE",
  "ES",
  "IT",
  "NL",
  "PT",
  "IE",
  "AU",
  "NZ",
]);

/**
 * US state / territory codes. Must NEVER be sent to Stripe as `country`
 * (was causing: Country 'NY' is unknown for drivers with state=NY).
 * Includes CA so California is not treated as Canada unless country_code=CA.
 */
const US_STATE_OR_TERRITORY_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC", "PR",
  "VI", "GU", "AS", "MP",
]);

const US_STATE_NAMES = new Set([
  "ALABAMA", "ALASKA", "ARIZONA", "ARKANSAS", "CALIFORNIA", "COLORADO",
  "CONNECTICUT", "DELAWARE", "FLORIDA", "GEORGIA", "HAWAII", "IDAHO",
  "ILLINOIS", "INDIANA", "IOWA", "KANSAS", "KENTUCKY", "LOUISIANA", "MAINE",
  "MARYLAND", "MASSACHUSETTS", "MICHIGAN", "MINNESOTA", "MISSISSIPPI",
  "MISSOURI", "MONTANA", "NEBRASKA", "NEVADA", "NEW HAMPSHIRE", "NEW JERSEY",
  "NEW MEXICO", "NEW YORK", "NORTH CAROLINA", "NORTH DAKOTA", "OHIO",
  "OKLAHOMA", "OREGON", "PENNSYLVANIA", "RHODE ISLAND", "SOUTH CAROLINA",
  "SOUTH DAKOTA", "TENNESSEE", "TEXAS", "UTAH", "VERMONT", "VIRGINIA",
  "WASHINGTON", "WEST VIRGINIA", "WISCONSIN", "WYOMING", "DISTRICT OF COLUMBIA",
]);

function normalizeStripeConnectCountry(value: unknown): string | null {
  const raw = String(value ?? "").trim().toUpperCase().replace(/['’]/g, "");
  if (!raw) return null;

  if (raw === "USA" || raw === "UNITED STATES" || raw === "UNITED STATES OF AMERICA") {
    return "US";
  }
  if (raw === "CANADA") return "CA";
  if (raw === "UNITED KINGDOM" || raw === "UK" || raw === "GREAT BRITAIN") return "GB";
  if (raw === "FRANCE") return "FR";
  if (raw === "BELGIUM") return "BE";
  if (raw === "GUINEA" || raw === "GUINEE" || raw === "REPUBLIC OF GUINEA") return "GN";
  if (raw === "SENEGAL") return "SN";
  if (
    raw === "COTE D IVOIRE" ||
    raw === "COTE DIVOIRE" ||
    raw === "IVORY COAST"
  ) {
    return "CI";
  }
  if (raw === "MALI") return "ML";
  if (raw === "SIERRA LEONE") return "SL";
  if (raw === "MAURITANIA") return "MR";

  // Full US state name → US (e.g. OHIO, NEW YORK)
  if (US_STATE_NAMES.has(raw) || US_STATE_NAMES.has(raw.replace(/\s+/g, " "))) {
    return "US";
  }

  if (/^[A-Z]{2}$/.test(raw)) {
    // Never treat a US state code as a Stripe country.
    if (US_STATE_OR_TERRITORY_CODES.has(raw)) return "US";
    if (STRIPE_CONNECT_COUNTRIES.has(raw)) return raw;
    return null;
  }

  return null;
}

function inferConnectCountryFromProfile(city: unknown, state: unknown): string {
  const cityText = String(city ?? "").trim().toUpperCase();
  if (cityText.includes("CONAKRY") || cityText.includes("GUINE")) return "GN";
  if (cityText.includes("DAKAR") || cityText.includes("SENEGAL")) return "SN";
  if (cityText.includes("ABIDJAN") || cityText.includes("IVOIRE")) return "CI";
  if (cityText.includes("BAMAKO") || cityText.includes("MALI")) return "ML";
  if (cityText.includes("FREETOWN") || cityText.includes("SIERRA")) return "SL";
  if (cityText.includes("NOUAKCHOTT") || cityText.includes("MAURITAN")) return "MR";
  if (
    cityText.includes("NEW YORK") ||
    cityText.includes("CANAL WINCHESTER") ||
    cityText.includes("COLUMBUS")
  ) {
    return "US";
  }
  return normalizeStripeConnectCountry(state) ?? "US";
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
    const businessAccountId = String(body?.business_account_id ?? "").trim();

    // Business wallet Connect (organizational account).
    if (roleRaw === "business") {
      if (!businessAccountId) {
        return json(req, { error: "business_account_id_required" }, 400);
      }

      const supabase = createClient(supabaseUrl, supabaseService, {
        auth: { persistSession: false },
      });

      const { data: membership } = await supabase
        .from("taxi_business_members")
        .select("role")
        .eq("business_account_id", businessAccountId)
        .eq("user_id", userId)
        .eq("active", true)
        .maybeSingle();

      if (!membership || !["manager", "admin"].includes(String(membership.role))) {
        return json(req, { error: "forbidden" }, 403);
      }

      const { data: biz } = await supabase
        .from("taxi_business_accounts")
        .select(
          "id,name,country_code,stripe_account_id,stripe_onboarding_status,stripe_charges_enabled,stripe_payouts_enabled,stripe_details_submitted"
        )
        .eq("id", businessAccountId)
        .maybeSingle();

      if (!biz) return json(req, { error: "business_account_not_found" }, 404);

      let accountId = String(biz.stripe_account_id ?? "").trim();
      const connectCountry = normalizeStripeConnectCountry(biz.country_code) ?? "US";

      if (!accountId) {
        const account = await stripe.accounts.create({
          type: "express",
          country: connectCountry,
          capabilities: {
            transfers: { requested: true },
            card_payments: { requested: true },
          },
          business_type: "company",
          settings: {
            payouts: {
              schedule: { interval: "manual" },
            },
          },
          metadata: {
            mmd_role: "business",
            business_account_id: businessAccountId,
            user_id: userId,
          },
        });
        accountId = account.id;
        await supabase
          .from("taxi_business_accounts")
          .update({
            stripe_account_id: accountId,
            stripe_onboarding_status: "created",
            owner_user_id: userId,
            country_code: connectCountry,
            updated_at: new Date().toISOString(),
          })
          .eq("id", businessAccountId);
      }

      const acct = await stripe.accounts.retrieve(accountId);
      const onboarded =
        Boolean(acct.details_submitted) &&
        Boolean(acct.charges_enabled) &&
        Boolean(acct.payouts_enabled);

      await supabase
        .from("taxi_business_accounts")
        .update({
          stripe_charges_enabled: Boolean(acct.charges_enabled),
          stripe_payouts_enabled: Boolean(acct.payouts_enabled),
          stripe_details_submitted: Boolean(acct.details_submitted),
          stripe_onboarding_status: onboarded
            ? "ready_for_payouts"
            : "verification_pending",
          stripe_onboarded_at: onboarded ? new Date().toISOString() : null,
        })
        .eq("id", businessAccountId);

      if (onboarded) {
        const login = await stripe.accounts.createLoginLink(accountId);
        return json(req, {
          ok: true,
          role: "business",
          business_account_id: businessAccountId,
          account_id: accountId,
          already_complete: true,
          onboarding_url: login.url,
          login_url: login.url,
        });
      }

      const link = await stripe.accountLinks.create({
        account: accountId,
        refresh_url: `${Deno.env.get("APP_URL") ?? "https://www.mmddelivery.com"}/taxi/business/wallet?connect=refresh`,
        return_url: `${Deno.env.get("APP_URL") ?? "https://www.mmddelivery.com"}/taxi/business/wallet?connect=return`,
        type: "account_onboarding",
      });

      return json(req, {
        ok: true,
        role: "business",
        business_account_id: businessAccountId,
        account_id: accountId,
        onboarding_url: link.url,
        needs_onboarding: true,
      });
    }

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
        { error: "Invalid role. Must be 'driver', 'restaurant', 'seller', or 'business'." },
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

    // Prefer explicit country_code from client/profile. Never pass raw `state`
    // (US states like NY/OH were incorrectly sent as Stripe country codes).
    const connectCountry =
      normalizeStripeConnectCountry(body?.country_code) ??
      normalizeStripeConnectCountry(body?.countryCode) ??
      normalizeStripeConnectCountry((prof as any)?.country_code) ??
      inferConnectCountryFromProfile((prof as any)?.city, (prof as any)?.state);

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
        settings: {
          payouts: {
            schedule: { interval: "manual" as const },
          },
        },
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

      // Bank payouts are MMD-scheduled (Sunday 04:00 ET). Disable Stripe auto daily.
      try {
        await stripe.accounts.update(accountId, {
          settings: {
            payouts: {
              schedule: {
                interval: "manual",
              },
            },
          },
        });
      } catch (schedErr) {
        console.warn(
          "create_connect_account: could not set manual payout schedule",
          schedErr instanceof Error ? schedErr.message : schedErr,
        );
      }

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
          ...(role === "restaurant" ? { stripe_onboarded: onboarded } : {}),
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
