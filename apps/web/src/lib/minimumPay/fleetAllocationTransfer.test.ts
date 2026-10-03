import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { approveFleetAllocationTransfer } from "./approveFleetAllocationTransfer";
import { computeStandardMinimumPay } from "./computeStandardMinimumPay";
import {
  canAutomaticallyTransferMinimumPayKind,
  canTransferMinimumPayAdjustments,
} from "./engineGate";
import { executeNycMprAdjustmentTransfer } from "./executeNycMprAdjustmentTransfer";
import { stripe } from "@/lib/stripe";

const webRoot = process.cwd();
const closePay = readFileSync(join(webRoot, "src/lib/minimumPay/closePayPeriod.ts"), "utf8");
const transferSrc = readFileSync(
  join(webRoot, "src/lib/minimumPay/executeNycMprAdjustmentTransfer.ts"),
  "utf8"
);
const adjustmentsApi = readFileSync(
  join(webRoot, "app/api/admin/minimum-pay/adjustments/route.ts"),
  "utf8"
);
const computeSrc = readFileSync(
  join(webRoot, "src/lib/minimumPay/computeStandardMinimumPay.ts"),
  "utf8"
);
const moneySrc = readFileSync(join(webRoot, "src/lib/minimumPay/money.ts"), "utf8");
const v1Fee = readFileSync(
  join(webRoot, "src/lib/pricingEngine/engine/compute/deliveryFeeV1.ts"),
  "utf8"
);

const HOUR = 3600_000;
const origin = Date.parse("2000-01-03T00:00:00.000Z");

function interval(startHour: number, endHour: number) {
  return {
    startedAtMs: origin + startHour * HOUR,
    endedAtMs: origin + endHour * HOUR,
  };
}

const activeSettings = {
  singleton: true,
  mode: "active",
  transfers_enabled: true,
  engine_start_at: "1999-01-01T00:00:00.000Z",
  default_currency: "usd",
  timezone: "America/New_York",
  period_length_days: 7,
  period_start_weekday: 1,
  default_jurisdiction: "nyc",
  default_method: "standard",
  default_rounding: "half_up_cents",
  eligible_county_codes: [],
  eligible_source_types: ["delivery_share"],
  excluded_source_types: [],
  wait_fee_counts: false,
  bonus_counts: false,
  on_call_stale_after_seconds: null,
  require_change_reason: false,
};

function settingsClient() {
  return {
    from(table: string) {
      if (table !== "minimum_pay_engine_settings") {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: activeSettings, error: null }),
      };
    },
  };
}

test("TEST 1 individual automatic transfer remains allowed", async () => {
  assert.equal(canAutomaticallyTransferMinimumPayKind("individual"), true);
  const start = Date.parse("1999-01-01T00:00:00.000Z") + 1000;
  assert.equal(
    canTransferMinimumPayAdjustments(
      {
        mode: "active",
        engineStartAt: "1999-01-01T00:00:00.000Z",
        timezone: "America/New_York",
        periodLengthDays: 7,
        periodStartWeekday: 1,
        defaultJurisdiction: "nyc",
        defaultCurrency: "usd",
        defaultMethod: "standard",
        defaultRounding: "half_up_cents",
        eligibleCountyCodes: [],
        eligibleSourceTypes: ["delivery_share"],
        excludedSourceTypes: [],
        waitFeeCounts: false,
        bonusCounts: false,
        transfersEnabled: true,
        onCallStaleAfterSeconds: null,
        requireChangeReason: false,
      },
      start
    ),
    true
  );
  assert.match(closePay, /canAutomaticallyTransferMinimumPayKind\(item\.kind\)/);
  assert.match(closePay, /automaticTransfer/);
  assert.doesNotMatch(
    closePay,
    /if \(mode === "shadow" \|\| !transferAllowed \|\| item\.adjustment <= 0\) continue/
  );
});

test("TEST 2 fleet allocation automatic Stripe transfer is blocked", async () => {
  const result = await executeNycMprAdjustmentTransfer(settingsClient() as never, {
    adjustmentId: "adj-fleet",
    driverId: "driver-a",
    amountCents: 25000,
    currency: "usd",
    idempotencyKey: "nyc_mpr_adjustment:driver-a:p:r:standard:fleet_allocation",
    destinationAccountId: "acct_test",
    kind: "fleet_allocation",
    metadata: { kind: "fleet_allocation" },
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.skipped, true);
    assert.equal(result.reason, "fleet_allocation_requires_manual_approval");
  }
  assert.match(closePay, /automaticTransfer/);
  assert.match(transferSrc, /manualFleetApproval !== true/);
  assert.match(transferSrc, /fleet_allocation_requires_manual_approval/);
});

test("TEST 3 authorized fleet approval can execute the existing Stripe path", async () => {
  const originalCreate = stripe.transfers.create.bind(stripe);
  let stripeCalls = 0;
  const updates: Array<Record<string, unknown>> = [];
  const audits: Array<Record<string, unknown>> = [];
  const earnings: Array<Record<string, unknown>> = [];
  const row = {
    id: "adj-fleet-1",
    driver_id: "driver-a",
    pay_period_id: "period-1",
    rule_version_id: "rule-1",
    kind: "fleet_allocation",
    required_cents: 50000,
    eligible_cents: 0,
    adjustment_cents: 25000,
    status: "computed",
    stripe_transfer_id: null,
    idempotency_key: "nyc_mpr_adjustment:driver-a:period-1:rule-1:standard:fleet_allocation",
  };
  const store = { ...row };

  stripe.transfers.create = (async () => {
    stripeCalls += 1;
    return { id: "tr_fleet_manual_1" };
  }) as unknown as typeof stripe.transfers.create;

  const supabase = {
    from(table: string) {
      if (table === "minimum_pay_engine_settings") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({ data: activeSettings, error: null }),
        };
      }
      if (table === "minimum_pay_adjustments") {
        return {
          select() {
            return this;
          },
          eq(column: string, value: unknown) {
            if (column === "id" && value !== store.id) store.id = store.id;
            return this;
          },
          is() {
            return this;
          },
          maybeSingle: async () => ({ data: { ...store }, error: null }),
          update(patch: Record<string, unknown>) {
            updates.push(patch);
            Object.assign(store, patch);
            return {
              eq() {
                return this;
              },
              is() {
                return this;
              },
              select() {
                return this;
              },
              maybeSingle: async () => ({ data: { id: store.id }, error: null }),
            };
          },
        };
      }
      if (table === "minimum_pay_calculation_audits") {
        return {
          insert(payload: Record<string, unknown>) {
            audits.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "driver_profiles") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({
            data: { stripe_account_id: "acct_fleet" },
            error: null,
          }),
        };
      }
      if (table === "earnings_lines") {
        return {
          upsert(payload: Record<string, unknown>) {
            earnings.push(payload);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  try {
    const result = await approveFleetAllocationTransfer(supabase as never, {
      adjustmentId: "adj-fleet-1",
      actorUserId: "admin-1",
      actor: "admin:admin-1",
    });
    assert.equal(result.ok, true);
    if (result.ok && result.skipped === false) {
      assert.equal(result.transferId, "tr_fleet_manual_1");
      assert.equal(result.amountCents, 25000);
    }
    assert.equal(stripeCalls, 1);
    assert.equal(store.status, "transferred");
    assert.equal(store.stripe_transfer_id, "tr_fleet_manual_1");
    assert.equal(earnings.length, 1);
    assert.equal(audits.some((row) => row.actor === "admin:admin-1"), true);
  } finally {
    stripe.transfers.create = originalCreate;
  }
});

test("TEST 4 unauthorized approval is rejected server-side", async () => {
  assert.match(adjustmentsApi, /assertStaffPermission\("minimum_pay.manage"/);
  assert.match(adjustmentsApi, /approveFleetAllocationTransfer/);
  assert.doesNotMatch(adjustmentsApi, /adjustment_cents:\s*body/);

  const supabase = {
    from(table: string) {
      if (table === "minimum_pay_engine_settings") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({ data: activeSettings, error: null }),
        };
      }
      if (table === "minimum_pay_adjustments") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({
            data: {
              id: "adj-individual",
              driver_id: "driver-a",
              kind: "individual",
              adjustment_cents: 2213,
              status: "computed",
              stripe_transfer_id: null,
              idempotency_key: "key-ind",
            },
            error: null,
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  const result = await approveFleetAllocationTransfer(supabase as never, {
    adjustmentId: "adj-individual",
    actorUserId: "admin-1",
    actor: "admin:admin-1",
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "not_fleet_allocation");
});

test("TEST 5 approving the same fleet allocation twice does not create two Stripe transfers", async () => {
  let stripeCalls = 0;
  const originalCreate = stripe.transfers.create.bind(stripe);
  stripe.transfers.create = (async () => {
    stripeCalls += 1;
    return { id: "tr_should_not_run" };
  }) as unknown as typeof stripe.transfers.create;

  const supabase = {
    from(table: string) {
      if (table === "minimum_pay_engine_settings") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({ data: activeSettings, error: null }),
        };
      }
      if (table === "minimum_pay_adjustments") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle: async () => ({
            data: {
              id: "adj-fleet-2",
              driver_id: "driver-a",
              pay_period_id: "period-1",
              kind: "fleet_allocation",
              adjustment_cents: 25000,
              status: "transferred",
              stripe_transfer_id: "tr_existing",
              idempotency_key: "key-2",
            },
            error: null,
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };

  try {
    const result = await approveFleetAllocationTransfer(supabase as never, {
      adjustmentId: "adj-fleet-2",
      actorUserId: "admin-1",
      actor: "admin:admin-1",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.skipped, true);
      assert.equal(result.reason, "already_transferred");
      assert.equal(result.transferId, "tr_existing");
    }
    assert.equal(stripeCalls, 0);
  } finally {
    stripe.transfers.create = originalCreate;
  }
});

test("TEST 6 scheduler closePayPeriod cannot auto-transfer fleet allocation", () => {
  assert.match(closePay, /canAutomaticallyTransferMinimumPayKind\(item\.kind\)/);
  assert.match(
    closePay,
    /kind: "fleet_allocation"[\s\S]*automaticTransfer[\s\S]*if \(!automaticTransfer\) continue/
  );
  assert.equal(canAutomaticallyTransferMinimumPayKind("fleet_allocation"), false);
});

test("TEST 7 formula isolation: individual, aggregate, deficit, and floorSpread stay unchanged", () => {
  const result = computeStandardMinimumPay({
    config: {
      method: "standard",
      mprCentsPerHour: 2213,
      rounding: "half_up_cents",
    },
    periodStartsAtMs: origin - HOUR,
    periodEndsAtMs: origin + 40 * HOUR,
    drivers: [
      {
        driverId: "A-0trip",
        tripIntervals: [],
        onCallIntervals: [interval(0, 10)],
        earnings: [],
      },
      {
        driverId: "C-1h",
        tripIntervals: [interval(0, 1)],
        onCallIntervals: [interval(1, 3)],
        earnings: [
          { sourceType: "delivery_share", amountCents: 2000, countsTowardMpr: true },
        ],
      },
    ],
  });
  assert.equal(result.drivers[0].requiredCents, 0);
  assert.equal(result.drivers[1].requiredCents, 2213);
  assert.equal(result.drivers[1].adjustmentCents, 213);
  assert.equal(result.requiredAggCents, 28769);
  assert.equal(result.eligibleAggCents, 2213);
  assert.equal(result.fleetDeficitCents, 26556);
  assert.ok((result.drivers[0].fleetAllocationCents ?? 0) > 0);
  assert.match(computeSrc, /weight: row\.onCallSeconds > 0 \? row\.onCallSeconds : row\.tripSeconds/);
  assert.match(moneySrc, /export function floorSpread/);
  assert.doesNotMatch(computeSrc, /tripSeconds > 0/);
  assert.doesNotMatch(computeSrc, /Platinum|driver_tier|DRIVER_LEVELS/);
});

test("TEST 8 V1 payment engine remains isolated", () => {
  assert.doesNotMatch(closePay, /deliveryFeeV1/);
  assert.doesNotMatch(transferSrc, /deliveryFeeV1/);
  assert.match(v1Fee, /export function/);
  assert.doesNotMatch(
    readFileSync(join(webRoot, "src/lib/minimumPay/approveFleetAllocationTransfer.ts"), "utf8"),
    /deliveryFeeV1|driver_cents|delivery_share/
  );
});
