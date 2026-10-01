import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const roots = [
  join(process.cwd(), "src/lib/minimumPay"),
  join(process.cwd(), "app/admin/minimum-pay"),
  join(process.cwd(), "app/api/admin/minimum-pay"),
  join(process.cwd(), "app/api/cron/nyc-minimum-pay"),
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|sql)$/.test(name) && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

test("engine source has no hardcoded regulatory rates or launch dates", () => {
  const banned = [
    "22.13",
    "21.44",
    "2213",
    "2144",
    "2026-04-01",
    "2026-09-30",
    "NYC_MINIMUM",
    "MINIMUM_RATE",
    "default 'USD'",
    '?? "usd"',
    '?? "USD"',
  ];
  const files = [
    ...roots.flatMap((root) => walk(root)),
    join(process.cwd(), "../../supabase/migrations/20261130120000_minimum_pay_engine.sql"),
  ];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const token of banned) {
      assert.equal(text.includes(token), false, `${file} contains ${token}`);
    }
  }
});
