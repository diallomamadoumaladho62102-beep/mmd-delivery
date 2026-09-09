import test from "node:test";
import assert from "node:assert/strict";
import { cuisineTypeSlug, localizedCuisineType } from "./localizeCuisineType";

test("cuisineTypeSlug normalizes known category labels", () => {
  assert.equal(cuisineTypeSlug("African"), "african");
  assert.equal(cuisineTypeSlug("West African Food"), "west_african_food");
  assert.equal(cuisineTypeSlug("  West African  "), "west_african");
});

test("localizedCuisineType uses i18n when the key exists", () => {
  const t = (key: string) =>
    key === "client.restaurants.cuisine.african" ? "Africaine" : key;
  assert.equal(localizedCuisineType(t, "African"), "Africaine");
});

test("localizedCuisineType keeps custom restaurant-entered cuisine as data", () => {
  const t = (key: string) => key;
  assert.equal(localizedCuisineType(t, "Binta's Kitchen Grill"), "Binta's Kitchen Grill");
});
