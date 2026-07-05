import assert from "node:assert/strict";
import test from "node:test";
import {
  driverAcceptsService,
  hasAnyServiceEnabled,
} from "./vehicleCategoryEligibility";

type Prefs = {
  food_delivery_enabled: boolean;
  package_delivery_enabled: boolean;
  taxi_rides_enabled: boolean;
};

function shouldReceiveDispatch(prefs: Prefs, service: "food" | "package" | "taxi"): boolean {
  return driverAcceptsService(prefs, service);
}

const combinations: Array<{ name: string; prefs: Prefs; food: boolean; package: boolean; taxi: boolean }> = [
  {
    name: "food only",
    prefs: { food_delivery_enabled: true, package_delivery_enabled: false, taxi_rides_enabled: false },
    food: true,
    package: false,
    taxi: false,
  },
  {
    name: "package only",
    prefs: { food_delivery_enabled: false, package_delivery_enabled: true, taxi_rides_enabled: false },
    food: false,
    package: true,
    taxi: false,
  },
  {
    name: "taxi only",
    prefs: { food_delivery_enabled: false, package_delivery_enabled: false, taxi_rides_enabled: true },
    food: false,
    package: false,
    taxi: true,
  },
  {
    name: "food + package",
    prefs: { food_delivery_enabled: true, package_delivery_enabled: true, taxi_rides_enabled: false },
    food: true,
    package: true,
    taxi: false,
  },
  {
    name: "food + taxi",
    prefs: { food_delivery_enabled: true, package_delivery_enabled: false, taxi_rides_enabled: true },
    food: true,
    package: false,
    taxi: true,
  },
  {
    name: "package + taxi",
    prefs: { food_delivery_enabled: false, package_delivery_enabled: true, taxi_rides_enabled: true },
    food: false,
    package: true,
    taxi: true,
  },
  {
    name: "all three",
    prefs: { food_delivery_enabled: true, package_delivery_enabled: true, taxi_rides_enabled: true },
    food: true,
    package: true,
    taxi: true,
  },
  {
    name: "none",
    prefs: { food_delivery_enabled: false, package_delivery_enabled: false, taxi_rides_enabled: false },
    food: false,
    package: false,
    taxi: false,
  },
];

for (const combo of combinations) {
  test(`dispatch matrix: ${combo.name}`, () => {
    assert.equal(shouldReceiveDispatch(combo.prefs, "food"), combo.food);
    assert.equal(shouldReceiveDispatch(combo.prefs, "package"), combo.package);
    assert.equal(shouldReceiveDispatch(combo.prefs, "taxi"), combo.taxi);
  });
}

test("driver with food only never receives taxi dispatch flag", () => {
  const prefs = {
    food_delivery_enabled: true,
    package_delivery_enabled: false,
    taxi_rides_enabled: false,
  };
  assert.equal(driverAcceptsService(prefs, "food"), true);
  assert.equal(driverAcceptsService(prefs, "taxi"), false);
});

test("driver with taxi only never receives food dispatch flag", () => {
  const prefs = {
    food_delivery_enabled: false,
    package_delivery_enabled: false,
    taxi_rides_enabled: true,
  };
  assert.equal(driverAcceptsService(prefs, "taxi"), true);
  assert.equal(driverAcceptsService(prefs, "food"), false);
});

test("driver with package only never receives food dispatch flag", () => {
  const prefs = {
    food_delivery_enabled: false,
    package_delivery_enabled: true,
    taxi_rides_enabled: false,
  };
  assert.equal(driverAcceptsService(prefs, "package"), true);
  assert.equal(driverAcceptsService(prefs, "food"), false);
});

test("no service enabled blocks online eligibility", () => {
  assert.equal(
    hasAnyServiceEnabled({
      food_delivery_enabled: false,
      package_delivery_enabled: false,
      taxi_rides_enabled: false,
    }),
    false,
  );
});

test("filter simulation scales for 10000 drivers in memory", () => {
  const ids = Array.from({ length: 10_000 }, (_, i) => `driver-${i}`);
  const prefs = new Map<string, Prefs>();
  for (const id of ids) {
    const n = Number(id.split("-")[1]);
    prefs.set(id, {
      food_delivery_enabled: n % 3 === 0,
      package_delivery_enabled: n % 3 === 1,
      taxi_rides_enabled: n % 3 === 2,
    });
  }

  const start = performance.now();
  const foodEligible = ids.filter((id) => driverAcceptsService(prefs.get(id)!, "food"));
  const elapsed = performance.now() - start;

  assert.ok(foodEligible.length > 0);
  assert.ok(elapsed < 500, `filter too slow: ${elapsed}ms`);
});
