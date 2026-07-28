/**
 * Shared Stripe Connect onboarding status for Drivers / Restaurants.
 * Strict readiness: details_submitted && charges_enabled && payouts_enabled.
 */

export type StripeConnectStatusCode =
  | "setup_required"
  | "verification_pending"
  | "verification_in_progress"
  | "ready_for_payouts"
  | "restricted"
  | "disabled";

export type StripeConnectFlags = {
  stripe_account_id?: string | null;
  details_submitted?: boolean | null;
  charges_enabled?: boolean | null;
  payouts_enabled?: boolean | null;
  disabled_reason?: string | null;
  currently_due_count?: number | null;
  past_due_count?: number | null;
};

export function isStripeConnectFullyReady(flags: StripeConnectFlags): boolean {
  return (
    Boolean(flags.stripe_account_id) &&
    Boolean(flags.details_submitted) &&
    Boolean(flags.charges_enabled) &&
    Boolean(flags.payouts_enabled)
  );
}

export function deriveStripeConnectStatus(
  flags: StripeConnectFlags
): StripeConnectStatusCode {
  if (!flags.stripe_account_id) return "setup_required";

  const disabled = String(flags.disabled_reason ?? "").trim();
  if (disabled) {
    if (/rejected|listed|under_review/i.test(disabled)) return "restricted";
    return "disabled";
  }

  if (isStripeConnectFullyReady(flags)) return "ready_for_payouts";

  const pastDue = Number(flags.past_due_count ?? 0);
  const currentlyDue = Number(flags.currently_due_count ?? 0);

  if (pastDue > 0) return "restricted";
  if (flags.details_submitted && (!flags.charges_enabled || !flags.payouts_enabled)) {
    return "verification_in_progress";
  }
  if (currentlyDue > 0 || !flags.details_submitted) {
    return "verification_pending";
  }

  return "verification_in_progress";
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
