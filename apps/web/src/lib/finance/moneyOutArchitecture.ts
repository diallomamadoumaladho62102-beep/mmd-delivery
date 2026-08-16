/**
 * Founder-approved money-out model (Wave 2b/2c).
 *
 * Platform → Connect uses Stripe Connect Transfers (SCT) only
 * (transfers/run, taxi-run / executeTaxiDriverFareTransfer, marketplacePayoutService,
 * executeDriverTipTransfer). Taxi fares: SCT immediately on ride complete (hold default 0);
 * cron taxi-payouts is retry/backfill.
 * Connect → bank: Express accounts use **manual** payout schedule; GitHub Actions
 * calls `/api/cron/driver-connect-bank-payouts` at Sunday 04:00 America/New_York
 * (dual UTC schedules for EDT/EST). No $20 minimum. Manual Cash Out may still enforce $20.
 *
 * Tips (Wave 2c): separate PaymentIntent (kind=driver_tip) → SCT with source_transaction
 * (see tipMoneyArchitecture.ts). Tips are never folded into delivery driver_cents.
 *
 * Legacy Supabase Edge payout functions are disabled by default
 * (MMD_EDGE_PAYOUTS_DISABLED must be explicitly set to "false" to re-enable).
 */
export const MONEY_OUT_MODEL = {
  platformToConnect: "stripe_transfer_sct",
  connectToBank: "manual_schedule_plus_github_actions_sunday_et",
  driverBankPayout: "sunday_0400_america_new_york_full_available_no_minimum",
  driverCashout: "connect_available_balance_payout_only",
  tipFunding: "separate_payment_intent_then_sct",
  legacyEdgePayouts: "disabled_by_default",
} as const;

export type MoneyOutModel = typeof MONEY_OUT_MODEL;
