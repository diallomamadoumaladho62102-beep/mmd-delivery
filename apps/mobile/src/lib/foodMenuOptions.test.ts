import assert from "node:assert/strict";
import {
  extrasCentsFromOptions,
  foodCartLineKey,
  parseFoodMenuOptionsCatalog,
} from "./foodMenuOptions";

const catalog = parseFoodMenuOptionsCatalog([
  { id: "extra-cheese", name: "Extra cheese", price_cents: 150 },
  { name: "No onions", price_cents: 0 },
  { id: "bad", name: "", price_cents: 10 },
]);

assert.equal(catalog.length, 2);
assert.equal(catalog[0]?.id, "extra-cheese");
assert.equal(catalog[1]?.id, "No onions");
assert.equal(foodCartLineKey("item-1", catalog), "item-1:No onions,extra-cheese");
assert.equal(extrasCentsFromOptions(catalog), 150);

console.log("foodMenuOptions.test.ts OK");
