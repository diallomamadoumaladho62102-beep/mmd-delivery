/**
 * Sunday Connect → bank eligibility (Drivers / Restaurants / Sellers).
 * Pure classification — no Stripe side effects.
 */
import {
  deriveStripeConnectStatus,
  stripeConnectStatusLabel,
  type StripeConnectStatusCode,
} from "@/lib/stripeConnectStatus";

export const SUNDAY_BANK_SKIP_REASONS = {
  MISSING_STRIPE_ACCOUNT: "missing_stripe_account",
  INVALID_STRIPE_ACCOUNT: "invalid_stripe_account",
  ZERO_AVAILABLE_BALANCE: "zero_available_balance",
  PENDING_FUNDS_SETTLING: "pending_funds_settling",
  NO_BANK_ACCOUNT: "no_bank_account_destination",
  OUTSIDE_WINDOW: "outside_sunday_4am_america_new_york_window",
  STRIPE_CONNECT_NOT_READY: "stripe_connect_not_ready",
} as const;

export type SundayBankSkipReason =
  (typeof SUNDAY_BANK_SKIP_REASONS)[keyof typeof SUNDAY_BANK_SKIP_REASONS];

export function classifyStripeConnectAccountId(id: unknown): {
  ok: boolean;
  accountId: string | null;
  reason: string | null;
} {
  const accountId = String(id ?? "").trim();
  if (!accountId) {
    return {
      ok: false,
      accountId: null,
      reason: SUNDAY_BANK_SKIP_REASONS.MISSING_STRIPE_ACCOUNT,
    };
  }
  if (!accountId.startsWith("acct_")) {
    return {
      ok: false,
      accountId: null,
      reason: SUNDAY_BANK_SKIP_REASONS.INVALID_STRIPE_ACCOUNT,
    };
  }
  return { ok: true, accountId, reason: null };
}

/**
 * Sunday pays Stripe *available* only. Pending settlement is retained
 * for a later eligible cycle — never a $0 payout, never marked paid.
 */
export function classifyAvailableVsPending(input: {
  availableCents: number;
  pendingCents: number;
}): { eligible: boolean; reason: string | null } {
  const availableCents = Math.max(
    0,
    Math.round(Number(input.availableCents) || 0),
  );
  const pendingCents = Math.max(0, Math.round(Number(input.pendingCents) || 0));
  if (availableCents > 0) return { eligible: true, reason: null };
  if (pendingCents > 0) {
    return {
      eligible: false,
      reason: SUNDAY_BANK_SKIP_REASONS.PENDING_FUNDS_SETTLING,
    };
  }
  return {
    eligible: false,
    reason: SUNDAY_BANK_SKIP_REASONS.ZERO_AVAILABLE_BALANCE,
  };
}

export function sundayBankBlockLabel(reason: string | null | undefined): string {
  switch (String(reason ?? "").trim()) {
    case SUNDAY_BANK_SKIP_REASONS.MISSING_STRIPE_ACCOUNT:
    case SUNDAY_BANK_SKIP_REASONS.INVALID_STRIPE_ACCOUNT:
      return "PAYOUT BLOCKED — STRIPE CONNECT ACCOUNT NOT CONFIGURED";
    case SUNDAY_BANK_SKIP_REASONS.PENDING_FUNDS_SETTLING:
      return "PENDING FUNDS — Stripe settlement, not available yet";
    case SUNDAY_BANK_SKIP_REASONS.ZERO_AVAILABLE_BALANCE:
      return "AVAILABLE FUNDS = 0 — no payout created";
    case SUNDAY_BANK_SKIP_REASONS.NO_BANK_ACCOUNT:
      return "PAYOUT BLOCKED — no verified bank account on Connect";
    case SUNDAY_BANK_SKIP_REASONS.OUTSIDE_WINDOW:
      return "OUTSIDE WINDOW — Sunday 04:00 America/New_York through end of Sunday";
    case SUNDAY_BANK_SKIP_REASONS.STRIPE_CONNECT_NOT_READY:
      return "PAYOUT BLOCKED — Stripe Connect not ready for payouts";
    default:
      return reason ? `PAYOUT BLOCKED — ${reason}` : "Eligible";
  }
}

export type SundayBankDbFlags = {
  stripe_account_id?: unknown;
  stripe_payouts_enabled?: boolean | null;
  stripe_charges_enabled?: boolean | null;
  stripe_details_submitted?: boolean | null;
  stripe_onboarded?: boolean | null;
};

export function classifySundayBankDbEligibility(input: SundayBankDbFlags): {
  eligible: boolean;
  reason: string | null;
  stripeAccountId: string | null;
  connectStatus: StripeConnectStatusCode;
  connectStatusLabel: string;
} {
  const acct = classifyStripeConnectAccountId(input.stripe_account_id);
  const onboarded = input.stripe_onboarded === true;
  const connectStatus = deriveStripeConnectStatus({
    stripe_account_id: acct.accountId,
    details_submitted: input.stripe_details_submitted ?? onboarded,
    charges_enabled: input.stripe_charges_enabled ?? onboarded,
    payouts_enabled: input.stripe_payouts_enabled ?? onboarded,
  });
  const connectStatusLabel = stripeConnectStatusLabel(connectStatus);

  if (!acct.ok) {
    return {
      eligible: false,
      reason: acct.reason,
      stripeAccountId: null,
      connectStatus,
      connectStatusLabel,
    };
  }

  if (connectStatus !== "ready_for_payouts") {
    return {
      eligible: false,
      reason: SUNDAY_BANK_SKIP_REASONS.STRIPE_CONNECT_NOT_READY,
      stripeAccountId: acct.accountId,
      connectStatus,
      connectStatusLabel,
    };
  }

  return {
    eligible: true,
    reason: null,
    stripeAccountId: acct.accountId,
    connectStatus,
    connectStatusLabel,
  };
}
