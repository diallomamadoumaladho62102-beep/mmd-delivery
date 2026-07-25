import assert from "node:assert/strict";
import { filterNavGroups } from "./adminNav";

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("finance nav excludes dispatch", () => {
  const groups = filterNavGroups({
    role: "finance",
    isFounder: false,
    hasPermission: (permission) =>
      permission === "hub.access" ||
      permission === "finance.read" ||
      permission === "payments.read" ||
      permission === "payouts.read" ||
      permission === "commissions.read" ||
      permission === "pricing.read" ||
      permission === "loyalty.read",
  });
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  assert.equal(hrefs.includes("/admin/dispatch"), false);
  assert.equal(hrefs.includes("/admin/finance"), true);
});

test("founder sees staff administration", () => {
  const groups = filterNavGroups({
    role: "admin",
    isFounder: true,
    hasPermission: () => false,
  });
  const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  assert.equal(hrefs.includes("/admin/staff"), true);
  assert.equal(hrefs.includes("/admin/hr"), true);
});

console.log("adminNav tests passed");
