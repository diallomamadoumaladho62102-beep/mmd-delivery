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

function deriveStatus(params: {
  accountId: string | null;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  disabledReason: string | null;
  currentlyDue: number;
  pastDue: number;
}): string {
  if (!params.accountId) return "setup_required";
  if (params.disabledReason) {
    if (/rejected|listed|under_review/i.test(params.disabledReason)) {
      return "restricted";
    }
    return "disabled";
  }
  if (params.detailsSubmitted && params.chargesEnabled && params.payoutsEnabled) {
    return "ready_for_payouts";
  }
  if (params.pastDue > 0) return "restricted";
  if (params.detailsSubmitted && (!params.chargesEnabled || !params.payoutsEnabled)) {
    return "verification_in_progress";
  }
  if (params.currentlyDue > 0 || !params.detailsSubmitted) {
    return "verification_pending";
  }
  return "verification_in_progress";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: buildCorsHeaders(req) });
  }

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
      return json(req, { error: "Missing Supabase env vars" }, 500);
    }
    if (!stripeKey) {
      return json(req, { error: "Missing STRIPE_SECRET_KEY" }, 500);
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const authHeader =
      req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json(req, { error: "Missing Authorization Bearer token" }, 401);
    }

    const supabaseAuth = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userData, error: uErr } = await supabaseAuth.auth.getUser();
    if (uErr || !userData?.user) {
      return json(req, { error: "Not authenticated", details: uErr?.message }, 401);
    }

    const userId = userData.user.id;
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const roleRaw = String(body?.role ?? "").trim().toLowerCase();
    if (
      roleRaw !== "driver" &&
      roleRaw !== "restaurant" &&
      roleRaw !== "seller" &&
      roleRaw !== "merchant"
    ) {
      return json(
        req,
        {
          error: "invalid_role",
          message: "role must be driver|restaurant|seller",
        },
        400,
      );
    }
    const role =
      roleRaw === "restaurant"
        ? "restaurant"
        : roleRaw === "seller" || roleRaw === "merchant"
          ? "seller"
          : "driver";
    const table =
      role === "driver"
        ? "driver_profiles"
        : role === "restaurant"
          ? "restaurant_profiles"
          : "sellers";

    const supabase = createClient(supabaseUrl, supabaseService, {
      auth: { persistSession: false },
    });

    const { data: prof, error: pErr } = await supabase
      .from(table)
      .select(
        role === "driver"
          ? "stripe_account_id, stripe_onboarded"
          : "stripe_account_id, stripe_onboarding_status, stripe_charges_enabled, stripe_payouts_enabled, stripe_details_submitted",
      )
      .eq("user_id", userId)
      .maybeSingle();

    if (pErr) {
      return json(req, { error: "Profile read failed", details: pErr.message }, 400);
    }

    const accountId = (prof as { stripe_account_id?: string | null } | null)
      ?.stripe_account_id ?? null;

    if (!accountId) {
      return json(req, {
        ok: true,
        role,
        stripe_account_id: null,
        stripe_onboarded: false,
        details_submitted: false,
        charges_enabled: false,
        payouts_enabled: false,
        disabled_reason: null,
        currently_due: [],
        past_due: [],
        status: "setup_required",
        status_label: "Setup required",
        can_receive_payouts: false,
        needs_onboarding: true,
      });
    }

    let acct: Stripe.Account;
    try {
      acct = await stripe.accounts.retrieve(accountId);
    } catch (retrieveErr: unknown) {
      const message =
        retrieveErr instanceof Error ? retrieveErr.message : "Stripe retrieve failed";
      console.error("check_connect_status retrieve failed", accountId, message);
      return json(
        req,
        {
          ok: false,
          error: "stripe_account_retrieve_failed",
          message:
            "Unable to read your Stripe Connect account. Tap Enable payouts to reconnect.",
          details: message,
          status: "setup_required",
          needs_onboarding: true,
        },
        400
      );
    }

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
    const status = deriveStatus({
      accountId,
      detailsSubmitted,
      chargesEnabled,
      payoutsEnabled,
      disabledReason,
      currentlyDue: currentlyDue.length,
      pastDue: pastDue.length,
    });

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
      await supabase
        .from(table)
        .update({
          stripe_onboarded_at: onboarded ? nowIso : null,
          stripe_charges_enabled: chargesEnabled,
          stripe_payouts_enabled: payoutsEnabled,
          stripe_details_submitted: detailsSubmitted,
          stripe_onboarding_status: status,
        })
        .eq("user_id", userId);
    }

    const labels: Record<string, string> = {
      setup_required: "Setup required",
      verification_pending: "Verification pending",
      verification_in_progress: "Verification in progress",
      ready_for_payouts: "Ready for payouts",
      restricted: "Restricted",
      disabled: "Disabled",
    };

    return json(req, {
      ok: true,
      role,
      stripe_account_id: accountId,
      stripe_onboarded: onboarded,
      details_submitted: detailsSubmitted,
      charges_enabled: chargesEnabled,
      payouts_enabled: payoutsEnabled,
      disabled_reason: disabledReason,
      currently_due: currentlyDue,
      past_due: pastDue,
      status,
      status_label: labels[status] ?? status,
      can_receive_payouts: onboarded,
      needs_onboarding: !onboarded,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    console.error("check_connect_status fatal:", message);
    return json(req, { error: message }, 500);
  }
});
