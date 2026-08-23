/**
 * Founder-approved money-out model (Wave 2b/2c).
 *
 * Platform → Connect uses Stripe Connect Transfers (SCT) only
 * (transfers/run, taxi-run / executeTaxiDriverFareTransfer, marketplacePayoutService,
 * executeDriverTipTransfer). Taxi fares: SCT immediately on ride complete (hold default 0);
 * cron taxi-payouts is retry/backfill.
 * Connect → bank: Express accounts use **manual** payout schedule; GitHub Actions
 * calls `/api/cron/driver-connect-bank-payouts` at Sunday 04:00 America/New_York
 * (dual UTC schedules for EDT/EST) for drivers and restaurants. No $20 minimum.
 * Manual Cash Out (Driver + Restaurant + Seller) enforces $20 and max 1/day
 * (America/New_York calendar day, atomic DB claim). Sunday bank cron remains
 * separate and pays only remaining Connect available balance (no $20 minimum).
 *
 * CRITICAL — Platform (MMD) Stripe payout schedule must stay **manual** (or delayed)
 * until unpaid Driver SCTs clear. Automatic platform bank payouts can drain charge
 * funds so `source_transaction` Transfers fail with `balance_insufficient` for older
 * rides; cron then retries from platform available when balance recovers.
 *
 * Note: Stripe API cannot change the **platform's own** payout schedule
 * (`accounts.update` only works on Connected Accounts). Founder must set
 * Dashboard → Settings → Payouts → Manual. Cron records `requires_dashboard`
 * when unpaid SCTs exist and schedule is still automatic.
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
  /** Platform bank payouts: prefer manual until unpaid SCT inventory is clear. */
  platformBankPayout: "manual_until_unpaid_driver_sct_clear",
  driverBankPayout: "sunday_0400_america_new_york_full_available_no_minimum",
  restaurantBankPayout: "sunday_0400_america_new_york_full_available_no_minimum",
  sellerBankPayout: "sunday_0400_america_new_york_full_available_no_minimum",
  driverCashout: "connect_available_balance_payout_only",
  restaurantCashout: "connect_available_balance_payout_only",
  sellerCashout: "connect_available_balance_payout_only",
  tipFunding: "separate_payment_intent_then_sct",
  legacyEdgePayouts: "disabled_by_default",
} as const;

export type MoneyOutModel = typeof MONEY_OUT_MODEL;
