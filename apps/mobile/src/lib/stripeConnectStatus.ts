/**
 * Stripe Connect onboarding status labels (mirrors web stripeConnectStatus).
 * Strict readiness: details_submitted && charges_enabled && payouts_enabled.
 */

export type StripeConnectStatusCode =
  | "setup_required"
  | "verification_pending"
  | "verification_in_progress"
  | "ready_for_payouts"
  | "restricted"
  | "disabled";

export function normalizeStripeConnectStatus(
  value: unknown,
): StripeConnectStatusCode {
  const code = String(value ?? "")
    .trim()
    .toLowerCase();
  switch (code) {
    case "setup_required":
    case "verification_pending":
    case "verification_in_progress":
    case "ready_for_payouts":
    case "restricted":
    case "disabled":
      return code;
    default:
      return "setup_required";
  }
}

export function stripeConnectStatusLabel(code: StripeConnectStatusCode): string {
  switch (code) {
    case "setup_required":
      return "Setup required";
    case "verification_pending":
      return "Verification pending";
    case "verification_in_progress":
      return "Verification in progress";
    case "ready_for_payouts":
      return "Ready for payouts";
    case "restricted":
      return "Restricted";
    case "disabled":
      return "Disabled";
    default:
      return "Setup required";
  }
}

export function stripeConnectUserMessage(code: StripeConnectStatusCode): string {
  switch (code) {
    case "setup_required":
      return "Complete Stripe setup to receive payouts. Tap Enable to continue.";
    case "verification_pending":
      return "Stripe still needs information from you. Continue onboarding to finish verification.";
    case "verification_in_progress":
      return "Stripe is reviewing your account. Payouts unlock when verification completes.";
    case "ready_for_payouts":
      return "Your Stripe account is ready. You can cash out when your balance allows.";
    case "restricted":
      return "Your Stripe account is restricted. Open Stripe setup to resolve outstanding requirements.";
    case "disabled":
      return "Your Stripe account is disabled. Contact support or reopen Stripe setup.";
    default:
      return "Complete Stripe setup to receive payouts.";
  }
}

export function isStripeConnectReady(code: StripeConnectStatusCode): boolean {
  return code === "ready_for_payouts";
}

export type RestaurantConnectFlags = {
  stripe_account_id?: string | null;
  stripe_onboarding_status?: string | null;
  stripe_charges_enabled?: boolean | null;
  stripe_payouts_enabled?: boolean | null;
  stripe_details_submitted?: boolean | null;
};

/** Never treat a restaurant as ready without a live Connect acct_. */
export function deriveRestaurantConnectStatus(
  profile: RestaurantConnectFlags | null | undefined,
): StripeConnectStatusCode {
  const accountId = String(profile?.stripe_account_id ?? "").trim();
  if (!accountId.startsWith("acct_")) {
    return "setup_required";
  }
  return normalizeStripeConnectStatus(
    profile?.stripe_onboarding_status ??
      (profile?.stripe_payouts_enabled &&
      profile?.stripe_charges_enabled &&
      profile?.stripe_details_submitted
        ? "ready_for_payouts"
        : profile?.stripe_details_submitted
          ? "verification_in_progress"
          : "verification_pending"),
  );
}

/** Restaurant/Seller bank-payout CTA copy. Stripe Express owns the bank form. */
export function restaurantStripeConnectCta(code: StripeConnectStatusCode): {
  title: string;
  body: string;
  action: string;
} {
  switch (code) {
    case "ready_for_payouts":
      return {
        title: "Stripe Connected",
        body: "Your bank account is connected. Open Stripe to manage payouts or update bank details.",
        action: "Manage Payouts",
      };
    case "verification_in_progress":
      return {
        title: "Stripe setup incomplete",
        body: "Stripe is reviewing your account. Continue setup if more bank or identity information is needed.",
        action: "Continue Stripe Setup",
      };
    case "verification_pending":
      return {
        title: "Complete Stripe Setup",
        body: "You started Stripe Connect. Finish identity and bank account details in Stripe to receive payouts.",
        action: "Complete Stripe Setup",
      };
    case "restricted":
    case "disabled":
      return {
        title: "Payout blocked",
        body: "Stripe cannot pay this restaurant yet. Open Stripe to fix the account, then payouts retry automatically.",
        action: "Fix Stripe Account",
      };
    case "setup_required":
    default:
      return {
        title: "Connect your bank account",
        body: "You must connect Stripe to receive restaurant payments. Stripe will ask for your legal name, identity, and bank account. MMD never collects bank details.",
        action: "Connect Stripe",
      };
  }
}
