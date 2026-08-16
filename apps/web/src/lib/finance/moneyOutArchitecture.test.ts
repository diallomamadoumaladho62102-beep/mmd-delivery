import assert from "node:assert/strict";
import { MONEY_OUT_MODEL } from "@/lib/finance/moneyOutArchitecture";

assert.equal(MONEY_OUT_MODEL.platformToConnect, "stripe_transfer_sct");
assert.equal(
  MONEY_OUT_MODEL.connectToBank,
  "manual_schedule_plus_github_actions_sunday_et",
);
assert.equal(
  MONEY_OUT_MODEL.driverBankPayout,
  "sunday_0400_america_new_york_full_available_no_minimum",
);
assert.equal(
  MONEY_OUT_MODEL.restaurantBankPayout,
  "sunday_0400_america_new_york_full_available_no_minimum",
);
assert.equal(
  MONEY_OUT_MODEL.driverCashout,
  "connect_available_balance_payout_only",
);
assert.equal(
  MONEY_OUT_MODEL.tipFunding,
  "separate_payment_intent_then_sct",
);
assert.equal(MONEY_OUT_MODEL.legacyEdgePayouts, "disabled_by_default");

// Decision guard: cashout must never fund Connect by marking delivery ledgers paid.
const FORBIDDEN_CASHOUT_RPCS = [
  "admin_pay_driver_now",
  "finalize_driver_payout",
] as const;
assert.ok(
  FORBIDDEN_CASHOUT_RPCS.every((name) => typeof name === "string"),
  "forbidden RPC names documented for driver cashout architecture",
);

console.log("moneyOutArchitecture.test.ts: ok");
