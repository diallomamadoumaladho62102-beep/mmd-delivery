/**
 * Founder-approved money-out model (Wave 2b/2c).
 *
 * Platform → Connect uses Stripe Connect Transfers (SCT) only
 * (transfers/run, taxi-run, marketplacePayoutService, executeDriverTipTransfer).
 * Connect → bank uses Stripe Express auto-payouts (or manual Cash Out of Connect available).
 * Driver Cash Out withdraws Connect **available** balance only — never marks unpaid
 * delivery ledgers paid. Unpaid driver earnings remain as awaiting SCT until transfers/run.
 *
 * Tips (Wave 2c): separate PaymentIntent (kind=driver_tip) → SCT with source_transaction
 * (see tipMoneyArchitecture.ts). Tips are never folded into delivery driver_cents.
 *
 * Legacy Supabase Edge payout functions are disabled by default
 * (MMD_EDGE_PAYOUTS_DISABLED must be explicitly set to "false" to re-enable).
 */
export const MONEY_OUT_MODEL = {
  platformToConnect: "stripe_transfer_sct",
  connectToBank: "stripe_express_payout",
  driverCashout: "connect_available_balance_payout_only",
  tipFunding: "separate_payment_intent_then_sct",
  legacyEdgePayouts: "disabled_by_default",
} as const;

export type MoneyOutModel = typeof MONEY_OUT_MODEL;
