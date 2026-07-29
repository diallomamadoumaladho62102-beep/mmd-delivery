/**
 * Driver module wave-1 verification checklist (static + unit).
 * Run: node scripts/proof-driver-module-wave1.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const mobileSrc = path.join(root, "apps/mobile/src");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function scan(dir, pred, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      scan(abs, pred, acc);
    } else if (ent.isFile() && /\.(ts|tsx)$/.test(ent.name)) {
      const text = fs.readFileSync(abs, "utf8");
      if (pred(text, abs)) acc.push(path.relative(root, abs).split(path.sep).join("/"));
    }
  }
  return acc;
}

const checks = [];

function check(id, ok, detail) {
  checks.push({ id, result: ok ? "PASS" : "FAIL", detail });
}

// Unit test via esbuild bundle
const esbuild = spawnSync(
  "npx",
  [
    "esbuild",
    "apps/mobile/src/lib/driverSetupProgress.test.ts",
    "--bundle",
    "--platform=node",
    "--outfile=.tmp/driver-setup-test.cjs",
  ],
  { cwd: root, encoding: "utf8", shell: true },
);
const unit = spawnSync("node", [".tmp/driver-setup-test.cjs"], {
  cwd: root,
  encoding: "utf8",
  shell: true,
});
check(
  "unit_driverSetupProgress",
  esbuild.status === 0 && unit.status === 0 && /OK/.test(unit.stdout || ""),
  (unit.stdout || unit.stderr || esbuild.stderr || "").trim().slice(0, 200),
);

const sot = read("apps/mobile/src/lib/driverSetupProgress.ts");
check(
  "sot_helper_exists",
  /isPayoutSetupOk/.test(sot) && /active_vehicle_id/.test(sot) && !/payout_enabled/.test(sot),
  "driverSetupProgress.ts is canonical SoT",
);

check(
  "no_configureDriverPayments",
  !/configureDriverPayments/.test(read("apps/mobile/src/lib/stripe.ts")),
  "dead Stripe helper removed",
);

check(
  "vehicle_photo_legacy",
  /expo-file-system\/legacy/.test(read("apps/mobile/src/lib/driverVehiclePhoto.ts")),
  "driverVehiclePhoto uses legacy FS",
);

const vehicleScreen = read("apps/mobile/src/screens/driver/DriverVehicleScreen.tsx");
check(
  "vehicle_picker_car_moto_bike",
  /changeDriverTransportMode/.test(vehicleScreen) &&
    /"car"/.test(vehicleScreen) &&
    /"moto"/.test(vehicleScreen) &&
    /"bike"/.test(vehicleScreen),
  "Add-vehicle starts with transport modes + RPC",
);

const onboarding = read("apps/mobile/src/screens/DriverOnboardingScreen.tsx");
check(
  "onboarding_hub_no_legacy_vehicle_write",
  /DriverVehicles/.test(onboarding) &&
    /DriverWallet/.test(onboarding) &&
    !/vehicle_brand\s*=/.test(onboarding) &&
    /changeDriverTransportMode/.test(onboarding),
  "Onboarding is hub; fleet via DriverVehicles",
);

const work = read("apps/mobile/src/screens/DriverWorkAccountScreen.tsx");
check(
  "workaccount_no_coming_soon",
  !/Coming soon/i.test(work) && !/common\.soon/.test(work),
  "WorkAccount maps to real screens only",
);

const account = read("apps/mobile/src/screens/DriverAccountScreen.tsx");
check(
  "account_uses_sot_helper",
  /computeDriverSetupProgress/.test(account) && !/payout_enabled\s*\|\|/.test(account),
  "Account progress via shared helper",
);

const home = read("apps/mobile/src/screens/DriverHomeScreen.tsx");
check(
  "home_active_vehicle_gate",
  /active_vehicle_id/.test(home) &&
    !/vehicle_brand\s*&&\s*!driver\.active_vehicle_id/.test(home) &&
    !/!driver\.vehicle_brand && !driver\.active_vehicle_id/.test(home),
  "Home online precheck matches server vehicle gate",
);

const profile = read("apps/mobile/src/screens/DriverProfileScreen.tsx");
check(
  "profile_motor_uses_active_vehicle",
  /active_vehicle_id/.test(profile) && /DriverVehicles/.test(profile),
  "Profile completeness + fleet CTA for fleet",
);

const webDriver = read("apps/web/app/orders/driver/page.tsx");
check(
  "web_driver_active_vehicle",
  /active_vehicle_id/.test(webDriver) && !/vehicle_brand\)\s*missing\.push\("vehicle brand"\)/.test(webDriver),
  "Web driver gate uses active_vehicle_id",
);

const brandGateHits = scan(mobileSrc, (text, abs) => {
  if (!/Driver/.test(abs) && !/driver/.test(abs)) return false;
  if (/driverSetupProgress/.test(abs)) return false;
  // Heuristic: brand used as completeness gate
  return /!.*vehicle_brand|vehicle_brand\s*&&|if\s*\(.*vehicle_brand/.test(text) &&
    /missing|complete|isMotor|vehicleOk|canAccess|canGoOnline/.test(text);
});
check(
  "no_brand_completeness_gates",
  brandGateHits.length === 0,
  brandGateHits.length ? `hits: ${brandGateHits.join(", ")}` : "none",
);

const report = {
  ok: checks.every((c) => c.result === "PASS"),
  generatedAt: new Date().toISOString(),
  checks,
  paths_required: {
    driverSetupProgress: exists("apps/mobile/src/lib/driverSetupProgress.ts"),
    vehicleScreen: exists("apps/mobile/src/screens/driver/DriverVehicleScreen.tsx"),
    onboarding: exists("apps/mobile/src/screens/DriverOnboardingScreen.tsx"),
  },
};

fs.mkdirSync(path.join(root, "apps/web/.tmp"), { recursive: true });
const out = path.join(root, "apps/web/.tmp/driver-module-wave1-proof.json");
fs.writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log("Wrote", out);
process.exit(report.ok ? 0 : 2);
