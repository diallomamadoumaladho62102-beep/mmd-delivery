/**
 * Static proof checks for Wave 2 financial P0 fixes.
 * Run: node scripts/proof-finance-wave2.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function check(id, ok, detail) {
  checks.push({ id, result: ok ? "PASS" : "FAIL", detail });
}

const wallet = read("apps/web/src/lib/driverWalletService.ts");
check(
  "wallet_live_stripe_retrieve",
  /stripe\.accounts\.retrieve/.test(wallet) &&
    /stripe_live_verified/.test(wallet) &&
    /DRIVER_CASHOUT_COOLDOWN_MS/.test(wallet) &&
    /DRIVER_CASHOUT_MINIMUM_CENTS/.test(wallet),
  "buildDriverWalletSummary uses live triad + 24h + $20 min",
);

const checkFn = read("supabase/functions/check_connect_status/index.ts");
check(
  "check_connect_requires_role",
  /invalid_role/.test(checkFn) && !/body\?\.role \?\? \"driver\"/.test(checkFn),
  "role required on check_connect_status",
);

const restoLink = read("supabase/functions/restaurant-connect-link/index.ts");
check(
  "restaurant_connect_no_hardcoded_us_only",
  /resolveStripeConnectCountry/.test(restoLink) &&
    !/country:\s*\"US\"/.test(restoLink),
  "restaurant-connect-link uses shared country resolver",
);

const earnings = read("apps/mobile/src/screens/RestaurantEarningsScreen.tsx");
check(
  "restaurant_earnings_server_pending",
  /serverPendingPayout/.test(earnings) &&
    /financial\/overview/.test(earnings),
  "Earnings Disponible prefers server overview",
);

// All check_connect_status invokes in apps must pass role in body
const appRoot = path.join(root, "apps");
const violators = [];
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === ".next") continue;
      walk(abs);
    } else if (/\.(ts|tsx)$/.test(ent.name)) {
      const text = fs.readFileSync(abs, "utf8");
      if (!text.includes("check_connect_status")) continue;
      // crude: invoke with only function name and no body role nearby
      const re = /functions\.invoke\(\s*["']check_connect_status["']\s*(?:,\s*\{([\s\S]*?)\})?\s*\)/g;
      let m;
      while ((m = re.exec(text))) {
        const opts = m[1] ?? "";
        if (!/role\s*:/.test(opts)) {
          violators.push(path.relative(root, abs).split(path.sep).join("/"));
        }
      }
    }
  }
}
walk(appRoot);
check(
  "all_check_connect_calls_pass_role",
  violators.length === 0,
  violators.length ? violators.join(", ") : "all callers pass role",
);

const countryTest = spawnSync("npx", ["tsx", "scripts/stripe-connect-country.test.ts"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
check(
  "country_unit_test",
  countryTest.status === 0,
  (countryTest.stdout || countryTest.stderr || "").trim().slice(0, 160),
);

const report = {
  ok: checks.every((c) => c.result === "PASS"),
  generatedAt: new Date().toISOString(),
  checks,
};

fs.mkdirSync(path.join(root, "apps/web/.tmp"), { recursive: true });
const out = path.join(root, "apps/web/.tmp/finance-wave2-proof.json");
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log("Wrote", out);
process.exit(report.ok ? 0 : 2);
