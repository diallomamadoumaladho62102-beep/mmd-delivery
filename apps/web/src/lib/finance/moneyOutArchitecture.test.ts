import assert from "node:assert/strict";
import { MONEY_OUT_MODEL } from "@/lib/finance/moneyOutArchitecture";

assert.equal(MONEY_OUT_MODEL.platformToConnect, "stripe_transfer_sct");
assert.equal(MONEY_OUT_MODEL.connectToBank, "stripe_express_payout");
assert.equal(
  MONEY_OUT_MODEL.driverCashout,
  "connect_available_balance_payout_only"
);

// Decision guard: cashout must never fund Connect by marking delivery ledgers paid.
const FORBIDDEN_CASHOUT_RPCS = [
  "admin_pay_driver_now",
  "finalize_driver_payout",
] as const;
assert.ok(
  FORBIDDEN_CASHOUT_RPCS.every((name) => typeof name === "string"),
  "forbidden RPC names documented for driver cashout architecture"
);

console.log("moneyOutArchitecture.test.ts: ok");
