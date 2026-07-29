/**
 * Founder-approved money-out model (Wave 2b).
 *
 * Platform → Connect uses Stripe Connect Transfers (SCT) only (transfers/run, taxi-run).
 * Connect → bank uses Stripe Express auto-payouts (or manual Cash Out of Connect available).
 * Driver Cash Out withdraws Connect **available** balance only — never marks unpaid
 * delivery ledgers paid. Unpaid driver earnings remain as awaiting SCT until transfers/run.
 */
export const MONEY_OUT_MODEL = {
  platformToConnect: "stripe_transfer_sct",
  connectToBank: "stripe_express_payout",
  driverCashout: "connect_available_balance_payout_only",
} as const;

export type MoneyOutModel = typeof MONEY_OUT_MODEL;
