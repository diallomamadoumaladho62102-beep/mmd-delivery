/**
 * Founder-approved money-out model (WorkerFinance).
 *
 * Platform → Connect: Stripe Connect Transfers (SCT) — internal only; immediate when eligible.
 * Connect → worker:
 * - Manual Cash Out: Instant Payout ONLY → Instant-eligible debit card or
 *   Instant-eligible bank (Stripe available_payout_methods). 100% Instant-eligible.
 *   No $ minimum. Max 1/day America/New_York. No standard fallback.
 * - Sunday America/New_York automatic bank (standard → ba_*):
 *   - 04:00 primary full available
 *   - 16:00 catch-up for funds that settled after primary (distinct idempotency keys)
 *
 * Wallet: Earnings / Available(Instant) / Cash Out / Next Sunday / Last status.
 * Never mark payout paid on create — wait for Stripe payout.paid.
 */
export const MONEY_OUT_MODEL = {
  platformToConnect: "stripe_transfer_sct",
  connectToBank: "manual_instant_debit_plus_sunday_standard_bank_et",
  platformBankPayout: "manual_until_unpaid_driver_sct_clear",
  driverBankPayout:
    "sunday_0400_and_1600_america_new_york_full_available_to_bank_no_minimum",
  restaurantBankPayout:
    "sunday_0400_and_1600_america_new_york_full_available_to_bank_no_minimum",
  sellerBankPayout:
    "sunday_0400_and_1600_america_new_york_full_available_to_bank_no_minimum",
  driverCashout: "connect_instant_payout_full_balance_debit_card_no_minimum",
  restaurantCashout: "connect_instant_payout_full_balance_debit_card_no_minimum",
  sellerCashout: "connect_instant_payout_full_balance_debit_card_no_minimum",
  tipFunding: "separate_payment_intent_then_sct",
  /** Edge pay-driver-now / process_driver_payouts: permanently stubbed (410/disabled). */
  legacyEdgePayouts: "permanently_disabled",
  manualCashoutMinimumCents: 0,
} as const;

export type MoneyOutModel = typeof MONEY_OUT_MODEL;
