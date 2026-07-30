import test from "node:test";
import assert from "node:assert/strict";
import { buildTaxiFareLines } from "@/lib/finance/buildTaxiReceipt";
import {
  filterFinancialEventsForRole,
  type FinancialTimelineEvent,
} from "@/lib/finance/financialTimelineTypes";

test("buildTaxiFareLines reconstructs base/distance/time from pricing snapshot", () => {
  const lines = buildTaxiFareLines({
    ride: {
      distance_miles: 2,
      duration_minutes: 10,
      tax_cents: 150,
      discount_cents: 200,
      tip_cents: 300,
      service_fee_cents: 50,
      wait_fee_amount_cents: 100,
      mmd_credit_applied_cents: 0,
      loyalty_discount_cents: 0,
      shared_discount_cents: 0,
      mmd_plus_discount_cents: 0,
    },
    pricing: {
      base_fare: 2.5,
      per_mile: 1.5,
      per_minute: 0.4,
      booking_fee: 1,
    },
  });

  const byKey = Object.fromEntries(lines.map((l) => [l.key, l.amount_cents]));
  assert.equal(byKey.base, 250);
  assert.equal(byKey.distance, 300); // 1.5 * 2 * 100
  assert.equal(byKey.time, 400); // 0.4 * 10 * 100
  assert.equal(byKey.booking_fee, 100);
  assert.equal(byKey.wait, 100);
  assert.equal(byKey.service_fee, 50);
  assert.equal(byKey.tax, 150);
  assert.equal(byKey.promo, -200);
  assert.equal(byKey.tip, 300);
  assert.equal(lines.some((l) => l.key === "surge"), false);
  assert.equal(lines.some((l) => l.key === "tolls"), false);
});

test("client financial timeline hides connect transfer events", () => {
  const events: FinancialTimelineEvent[] = [
    {
      id: "1",
      kind: "payment_intent",
      status: "paid",
      amount_cents: 1000,
      currency: "USD",
      direction: "debit",
      title_key: "finance.event.payment",
      title_fallback: "Payment",
      entity_type: "taxi_ride",
      entity_id: "r1",
      occurred_at: "2026-07-01T00:00:00Z",
    },
    {
      id: "2",
      kind: "transfer",
      status: "paid",
      amount_cents: 700,
      currency: "USD",
      direction: "credit",
      title_key: "finance.event.stripe_transfer",
      title_fallback: "Transfer",
      entity_type: "taxi_ride",
      entity_id: "r1",
      occurred_at: "2026-07-01T00:01:00Z",
    },
    {
      id: "3",
      kind: "tip",
      status: "paid",
      amount_cents: 200,
      currency: "USD",
      direction: "debit",
      title_key: "finance.event.tip",
      title_fallback: "Tip",
      entity_type: "taxi_ride",
      entity_id: "r1",
      occurred_at: "2026-07-01T00:02:00Z",
    },
  ];

  const client = filterFinancialEventsForRole(events, "client");
  assert.deepEqual(
    client.map((e) => e.kind),
    ["payment_intent", "tip"]
  );

  const driver = filterFinancialEventsForRole(events, "driver");
  assert.ok(driver.some((e) => e.kind === "transfer"));
});
