/**
 * Explicit commission freeze scenarios (mirrors SQL migration guards).
 * Pure logic — does not hit Stripe or production money.
 */
import assert from "node:assert/strict";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

type FreezeInput = {
  hasExistingCommissions: boolean;
  paymentStatus: string;
  hasSnapshot: boolean;
  restaurantTransferId: string | null;
  driverTransferId: string | null;
};

/** Same decision tree as 20261118120000 refresh_order_commissions freeze blocks. */
export function shouldFreezeOrderCommissions(input: FreezeInput): {
  freeze: boolean;
  reason: string | null;
} {
  if (
    input.hasExistingCommissions &&
    (String(input.restaurantTransferId ?? "").trim() ||
      String(input.driverTransferId ?? "").trim())
  ) {
    return { freeze: true, reason: "transfer_ids_present" };
  }
  if (
    input.hasExistingCommissions &&
    input.hasSnapshot &&
    String(input.paymentStatus ?? "").trim().toLowerCase() === "paid"
  ) {
    return { freeze: true, reason: "paid_with_snapshot" };
  }
  return { freeze: false, reason: null };
}

test("pricing_config change must not rewrite paid snapshotted commissions", () => {
  const before = shouldFreezeOrderCommissions({
    hasExistingCommissions: true,
    paymentStatus: "paid",
    hasSnapshot: true,
    restaurantTransferId: null,
    driverTransferId: null,
  });
  assert.equal(before.freeze, true);
  assert.equal(before.reason, "paid_with_snapshot");
});

test("transfer ids hard-freeze even if someone tries refresh", () => {
  const r = shouldFreezeOrderCommissions({
    hasExistingCommissions: true,
    paymentStatus: "paid",
    hasSnapshot: true,
    restaurantTransferId: "tr_abc",
    driverTransferId: null,
  });
  assert.equal(r.freeze, true);
  assert.equal(r.reason, "transfer_ids_present");
});

test("first create (no commissions yet) is not frozen", () => {
  const r = shouldFreezeOrderCommissions({
    hasExistingCommissions: false,
    paymentStatus: "paid",
    hasSnapshot: true,
    restaurantTransferId: null,
    driverTransferId: null,
  });
  assert.equal(r.freeze, false);
});

test("unpaid without transfer is not soft-frozen (may still compute)", () => {
  const r = shouldFreezeOrderCommissions({
    hasExistingCommissions: true,
    paymentStatus: "pending",
    hasSnapshot: true,
    restaurantTransferId: null,
    driverTransferId: null,
  });
  assert.equal(r.freeze, false);
});

console.log("commissionFreezeScenarios.regression passed");
