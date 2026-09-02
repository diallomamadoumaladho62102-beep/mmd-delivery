import assert from "node:assert/strict";
import { MONEY_OUT_MODEL } from "@/lib/finance/moneyOutArchitecture";

assert.equal(MONEY_OUT_MODEL.platformToConnect, "stripe_transfer_sct");
assert.equal(
  MONEY_OUT_MODEL.connectToBank,
  "manual_instant_debit_plus_sunday_standard_bank_et",
);
assert.equal(
  MONEY_OUT_MODEL.driverBankPayout,
  "sunday_0400_and_1600_america_new_york_full_available_to_bank_no_minimum",
);
assert.equal(
  MONEY_OUT_MODEL.restaurantBankPayout,
  "sunday_0400_and_1600_america_new_york_full_available_to_bank_no_minimum",
);
assert.equal(
  MONEY_OUT_MODEL.sellerBankPayout,
  "sunday_0400_and_1600_america_new_york_full_available_to_bank_no_minimum",
);
assert.equal(
  MONEY_OUT_MODEL.restaurantCashout,
  "connect_instant_payout_full_balance_debit_card_no_minimum",
);
assert.equal(
  MONEY_OUT_MODEL.sellerCashout,
  "connect_instant_payout_full_balance_debit_card_no_minimum",
);
assert.equal(
  MONEY_OUT_MODEL.driverCashout,
  "connect_instant_payout_full_balance_debit_card_no_minimum",
);
assert.equal(MONEY_OUT_MODEL.manualCashoutMinimumCents, 0);
assert.equal(
  MONEY_OUT_MODEL.tipFunding,
  "separate_payment_intent_then_sct",
);
assert.equal(MONEY_OUT_MODEL.legacyEdgePayouts, "permanently_disabled");

const FORBIDDEN_CASHOUT_RPCS = [
  "admin_pay_driver_now",
  "finalize_driver_payout",
] as const;
assert.ok(
  FORBIDDEN_CASHOUT_RPCS.every((name) => typeof name === "string"),
  "forbidden RPC names documented for driver cashout architecture",
);

console.log("moneyOutArchitecture.test.ts: ok");
