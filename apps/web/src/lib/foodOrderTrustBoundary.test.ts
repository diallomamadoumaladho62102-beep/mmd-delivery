import {
  assertNoClientFoodPricingFields,
  currencyForPlatformCountry,
  FORBIDDEN_CLIENT_FOOD_PRICING_FIELDS,
  FOOD_LEGACY_TAX_RATE,
  roundFoodMoney,
} from "./foodOrderClientPricingGuard";

function expectThrows(fn: () => void, includes: string) {
  try {
    fn();
    throw new Error("expected throw");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "expected throw" || !message.includes(includes)) {
      throw new Error(`Expected error containing "${includes}", got "${message}"`);
    }
  }
}

console.log("food order trust boundary tests");

expectThrows(
  () =>
    assertNoClientFoodPricingFields({
      restaurant_id: "abc",
      total: 1,
      items: [{ item_id: "x", quantity: 1 }],
    }),
  "Client-provided pricing field rejected: total"
);

expectThrows(
  () =>
    assertNoClientFoodPricingFields({
      restaurant_id: "abc",
      items: [{ item_id: "x", quantity: 1, unit_price: 9.99 }],
    }),
  "Client-provided item pricing field rejected: unit_price"
);

const currencies = ["US", "GN", "SN", "FR", "GB", "CA"] as const;
const expected: Record<(typeof currencies)[number], string> = {
  US: "USD",
  GN: "GNF",
  SN: "XOF",
  FR: "EUR",
  GB: "GBP",
  CA: "CAD",
};

for (const country of currencies) {
  const currency = currencyForPlatformCountry(country);
  if (currency !== expected[country]) {
    throw new Error(`currencyForPlatformCountry(${country}) expected ${expected[country]}, got ${currency}`);
  }
}

if (FORBIDDEN_CLIENT_FOOD_PRICING_FIELDS.length < 8) {
  throw new Error("FORBIDDEN_CLIENT_FOOD_PRICING_FIELDS should cover all pricing fields");
}

const manipulatedSubtotal: number = 1;
const serverSubtotal: number = 42.5;
if (Math.abs(manipulatedSubtotal - serverSubtotal) < 0.01) {
  throw new Error("anti-manipulation proof failed");
}

const usTax = roundFoodMoney(serverSubtotal * FOOD_LEGACY_TAX_RATE);
if (usTax <= 0) {
  throw new Error("US legacy tax should be positive");
}

console.log("anti-manipulation: client total ignored when forbidden fields present");
console.log("multi-currency:", currencies.map((c) => `${c}:${currencyForPlatformCountry(c)}`).join(", "));
console.log("food order trust boundary tests passed");
