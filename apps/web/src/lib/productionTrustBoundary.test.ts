import {
  assertNoClientDeliveryPricingFields,
  FORBIDDEN_CLIENT_DELIVERY_PRICING_FIELDS,
} from "./deliveryRequestClientPricingGuard";
import {
  assertNoClientFoodPricingFields,
  FORBIDDEN_CLIENT_FOOD_PRICING_FIELDS,
} from "./foodOrderClientPricingGuard";
import {
  currencyForPlatformCountry,
  PLATFORM_CHECKOUT_CURRENCIES,
  PLATFORM_CURRENCY_BY_COUNTRY,
} from "./platformCurrency";

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

console.log("production trust boundary tests");

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
    assertNoClientDeliveryPricingFields({
      pickup_address: "A",
      total: 0.01,
    }),
  "Client-provided pricing field rejected: total"
);

const countries = Object.keys(PLATFORM_CURRENCY_BY_COUNTRY);
for (const country of countries) {
  const currency = currencyForPlatformCountry(country, { strict: true });
  if (!PLATFORM_CHECKOUT_CURRENCIES.has(currency)) {
    throw new Error(`checkout currency not allowed: ${country} -> ${currency}`);
  }
}

if (FORBIDDEN_CLIENT_FOOD_PRICING_FIELDS.length < 8) {
  throw new Error("food forbidden fields too short");
}
if (FORBIDDEN_CLIENT_DELIVERY_PRICING_FIELDS.length < 8) {
  throw new Error("delivery forbidden fields too short");
}

console.log("anti-manipulation food + delivery guards OK");
console.log("multi-currency countries:", countries.join(", "));
console.log("production trust boundary tests passed");
