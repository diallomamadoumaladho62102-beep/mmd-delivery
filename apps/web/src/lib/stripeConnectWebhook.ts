/**
 * Sync Stripe Connect Express account.updated into driver / restaurant / seller profiles.
 * Canonical webhook is Vercel (/api/stripe/webhook); Edge stripe_webhook is disabled in prod.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import {
  deriveStripeConnectStatus,
  isStripeConnectFullyReady,
} from "@/lib/stripeConnectStatus";

export type ConnectAccountSyncResult = {
  ok: boolean;
  stripe_account_id: string;
  status: string;
  updated: {
    driver: boolean;
    restaurant: boolean;
    seller: boolean;
  };
  payout_retry?: unknown;
  error?: string;
};

function pickAccountId(event: Stripe.Event): string | null {
  const obj = event.data?.object as { id?: string } | null;
  if (obj && typeof obj.id === "string" && obj.id.startsWith("acct_")) {
    return obj.id;
  }
  if (typeof event.account === "string" && event.account.startsWith("acct_")) {
    return event.account;
  }
  return null;
}

export async function syncStripeConnectAccountUpdated(
  supabaseAdmin: SupabaseClient,
  stripe: Stripe,
  event: Stripe.Event
): Promise<ConnectAccountSyncResult> {
  const accountId = pickAccountId(event);
  if (!accountId) {
    return {
      ok: false,
      stripe_account_id: "",
      status: "setup_required",
      updated: { driver: false, restaurant: false, seller: false },
      error: "missing_account_id",
    };
  }

  let acct: Stripe.Account;
  try {
    acct = await stripe.accounts.retrieve(accountId);
  } catch (e) {
    return {
      ok: false,
      stripe_account_id: accountId,
      status: "setup_required",
      updated: { driver: false, restaurant: false, seller: false },
      error: e instanceof Error ? e.message : "stripe_retrieve_failed",
    };
  }

  const detailsSubmitted = Boolean(acct.details_submitted);
  const chargesEnabled = Boolean(acct.charges_enabled);
  const payoutsEnabled = Boolean(acct.payouts_enabled);
  const disabledReason =
    (acct.requirements as { disabled_reason?: string | null } | null)
      ?.disabled_reason ?? null;
  const currentlyDue = Array.isArray(acct.requirements?.currently_due)
    ? acct.requirements!.currently_due!.length
    : 0;
  const pastDue = Array.isArray(acct.requirements?.past_due)
    ? acct.requirements!.past_due!.length
    : 0;

  const status = deriveStripeConnectStatus({
    stripe_account_id: accountId,
    details_submitted: detailsSubmitted,
    charges_enabled: chargesEnabled,
    payouts_enabled: payoutsEnabled,
    disabled_reason: disabledReason,
    currently_due_count: currentlyDue,
    past_due_count: pastDue,
  });

  const onboarded = isStripeConnectFullyReady({
    stripe_account_id: accountId,
    details_submitted: detailsSubmitted,
    charges_enabled: chargesEnabled,
    payouts_enabled: payoutsEnabled,
  });
  const nowIso = new Date().toISOString();

  const updated = { driver: false, restaurant: false, seller: false };

  const { data: driverRows, error: driverErr } = await supabaseAdmin
    .from("driver_profiles")
    .update({
      stripe_onboarded: onboarded,
      stripe_onboarded_at: onboarded ? nowIso : null,
    })
    .eq("stripe_account_id", accountId)
    .select("user_id");

  if (driverErr) {
    console.error("[stripe-connect-webhook] driver update failed", driverErr.message);
  } else {
    updated.driver = Array.isArray(driverRows) && driverRows.length > 0;
  }

  const restaurantPayload = {
    stripe_onboarded_at: onboarded ? nowIso : null,
    stripe_charges_enabled: chargesEnabled,
    stripe_payouts_enabled: payoutsEnabled,
    stripe_details_submitted: detailsSubmitted,
    stripe_onboarding_status: status,
  };

  const { data: restaurantRows, error: restaurantErr } = await supabaseAdmin
    .from("restaurant_profiles")
    .update({
      ...restaurantPayload,
      stripe_onboarded: onboarded,
    })
    .eq("stripe_account_id", accountId)
    .select("user_id");

  if (restaurantErr) {
    console.error(
      "[stripe-connect-webhook] restaurant update failed",
      restaurantErr.message
    );
  } else {
    updated.restaurant = Array.isArray(restaurantRows) && restaurantRows.length > 0;
  }

  const { data: sellerRows, error: sellerErr } = await supabaseAdmin
    .from("sellers")
    .update({
      ...restaurantPayload,
    })
    .eq("stripe_account_id", accountId)
    .select("id");

  if (sellerErr) {
    console.error("[stripe-connect-webhook] seller update failed", sellerErr.message);
  } else {
    updated.seller = Array.isArray(sellerRows) && sellerRows.length > 0;
  }

  console.log("[stripe-connect-webhook] account.updated synced", {
    accountId,
    status,
    onboarded,
    updated,
  });

  let payout_retry: unknown = null;
  if (
    onboarded &&
    (updated.restaurant || updated.seller)
  ) {
    try {
      const { retryAwaitingConnectTransfers } = await import(
        "@/lib/finance/retryAwaitingConnectTransfers"
      );
      const restaurantUserIds = (restaurantRows ?? []).map((r) =>
        String((r as { user_id?: unknown }).user_id ?? ""),
      );
      payout_retry = await retryAwaitingConnectTransfers({
        supabaseAdmin,
        restaurantUserIds: updated.restaurant ? restaurantUserIds : [],
        sellerReady: updated.seller,
        limit: 8,
      });
      console.log("[stripe-connect-webhook] awaiting payout retry", payout_retry);
    } catch (e) {
      console.error("[stripe-connect-webhook] awaiting payout retry failed", {
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return {
    ok: true,
    stripe_account_id: accountId,
    status,
    updated,
    payout_retry,
  };
}
