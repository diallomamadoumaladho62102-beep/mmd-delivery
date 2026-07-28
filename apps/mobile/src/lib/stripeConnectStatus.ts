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
