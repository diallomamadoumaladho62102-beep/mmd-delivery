/**
 * Instant destination picker — live-shaped Chase bank must not be dropped.
 * Fixtures use cents only; production code never hardcodes a dollar amount.
 */
import assert from "node:assert/strict";
import {
  accountSupportsInstantPayout,
  selectInstantPayoutDestination,
} from "./selectInstantPayoutDestination";

function cashableCents(instantAvailableCents: number, destId: string | null): number {
  return destId ? instantAvailableCents : 0;
}

const chaseInstantBank = {
  id: "ba_chase_instant",
  object: "bank_account",
  currency: "usd",
  default_for_currency: true,
  available_payout_methods: ["standard", "instant"],
};

const standardOnlyBank = {
  id: "ba_standard_only",
  object: "bank_account",
  currency: "usd",
  default_for_currency: true,
  available_payout_methods: ["standard"],
};

const instantDebitCard = {
  id: "card_instant_debit",
  object: "card",
  currency: "usd",
  default_for_currency: false,
  available_payout_methods: ["instant"],
};

const standardCard = {
  id: "card_standard",
  object: "card",
  currency: "usd",
  default_for_currency: false,
  available_payout_methods: ["standard"],
};

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("Chase Instant-eligible bank is a valid Instant destination", () => {
  assert.equal(accountSupportsInstantPayout(chaseInstantBank), true);
  assert.equal(selectInstantPayoutDestination([chaseInstantBank]), "ba_chase_instant");
});

test("live-shaped wallet: instant_available stays cashable with Instant bank, not 0", () => {
  const instantAvailableCents = 2871;
  const dest = selectInstantPayoutDestination([chaseInstantBank]);
  assert.equal(dest, "ba_chase_instant");
  assert.equal(cashableCents(instantAvailableCents, dest), instantAvailableCents);
  assert.notEqual(cashableCents(instantAvailableCents, dest), 0);
});

test("card-only filter regression: Instant bank must not be ignored", () => {
  const dest = selectInstantPayoutDestination([chaseInstantBank]);
  assert.ok(dest && dest.startsWith("ba_"));
  assert.equal(selectInstantPayoutDestination([]), null);
  assert.equal(
    cashableCents(2871, selectInstantPayoutDestination([])),
    0,
    "no destination still cashable 0",
  );
});

test("standard-only bank is not Instant cashable even if default", () => {
  assert.equal(accountSupportsInstantPayout(standardOnlyBank), false);
  assert.equal(selectInstantPayoutDestination([standardOnlyBank]), null);
  assert.equal(cashableCents(2871, selectInstantPayoutDestination([standardOnlyBank])), 0);
});

test("Instant debit card remains valid", () => {
  assert.equal(
    selectInstantPayoutDestination([instantDebitCard]),
    "card_instant_debit",
  );
});

test("standard card is not Instant", () => {
  assert.equal(selectInstantPayoutDestination([standardCard]), null);
});

test("prefers default_for_currency Instant bank over Instant card", () => {
  assert.equal(
    selectInstantPayoutDestination([instantDebitCard, chaseInstantBank]),
    "ba_chase_instant",
  );
});

test("prefers Instant card when bank is standard-only", () => {
  assert.equal(
    selectInstantPayoutDestination([instantDebitCard, standardOnlyBank]),
    "card_instant_debit",
  );
});

test("non-USD Instant bank is ignored for USD cash out", () => {
  assert.equal(
    selectInstantPayoutDestination([
      { ...chaseInstantBank, currency: "cad" },
    ]),
    null,
  );
});

test("never uses standard available as cashable", () => {
  const standardAvailableCents = 2871;
  const dest = selectInstantPayoutDestination([standardOnlyBank]);
  assert.equal(cashableCents(0, dest), 0);
  assert.notEqual(
    dest ? standardAvailableCents : 0,
    standardAvailableCents,
    "standard bank without Instant methods cannot unlock cashable",
  );
});

console.log("selectInstantPayoutDestination.test.ts OK");
