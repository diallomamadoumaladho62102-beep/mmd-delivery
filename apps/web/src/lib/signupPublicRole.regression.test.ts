import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.join(process.cwd(), "../..");
const migration = fs.readFileSync(
  path.join(
    root,
    "supabase/migrations/20261212120000_signup_public_role_from_auth_metadata.sql",
  ),
  "utf8",
);
const driverSignup = fs.readFileSync(
  path.join(root, "apps/web/app/signup/driver/page.tsx"),
  "utf8",
);
const restaurantSignup = fs.readFileSync(
  path.join(root, "apps/web/app/signup/restaurant/page.tsx"),
  "utf8",
);
const clientSignup = fs.readFileSync(
  path.join(root, "apps/web/app/signup/client/page.tsx"),
  "utf8",
);
const clientAuth = fs.readFileSync(
  path.join(root, "apps/mobile/src/screens/ClientAuthScreen.tsx"),
  "utf8",
);
const roleSelect = fs.readFileSync(
  path.join(root, "apps/mobile/src/screens/RoleSelectScreen.tsx"),
  "utf8",
);
const sellerAuth = fs.readFileSync(
  path.join(root, "apps/web/src/lib/sellerLoyaltyAuth.ts"),
  "utf8",
);
const guardMigration = fs.readFileSync(
  path.join(
    root,
    "supabase/migrations/20261104120000_profiles_role_canonical_check.sql",
  ),
  "utf8",
);

assert.match(migration, /raw_user_meta_data ->> 'role'/);
assert.match(
  migration,
  /v_requested in \('client', 'driver', 'restaurant', 'seller'\)/,
);
assert.match(migration, /v_role text := 'client'/);
assert.match(migration, /on conflict \(id\) do nothing/);
const executable = migration.replace(/--.*$/gm, "");
assert.match(migration, /security definer/i);
assert.match(migration, /set search_path = public/);
assert.doesNotMatch(executable, /guard_profiles_privilege_columns/);
assert.doesNotMatch(executable, /update\s+public\.profiles/i);
assert.doesNotMatch(executable, /v_role := 'admin'/);
assert.doesNotMatch(executable, /v_role := 'super_admin'/);
assert.doesNotMatch(executable, /v_role := 'operations_admin'/);

assert.match(driverSignup, /const ROLE = "driver"/);
assert.match(
  driverSignup,
  /signInWithOtp\(\{[\s\S]*options:\s*\{[\s\S]*data:\s*\{\s*role:\s*ROLE\s*\}/,
);

assert.match(restaurantSignup, /const ROLE = "restaurant"/);
assert.match(restaurantSignup, /role:\s*ROLE/);
assert.match(clientSignup, /const ROLE = "client"/);
assert.match(clientSignup, /role:\s*ROLE/);

assert.match(clientAuth, /role:\s*"client"/);
assert.match(roleSelect, /navigation\.navigate\("ClientAuth"\)/);
assert.match(sellerAuth, /public\.sellers/);
assert.match(sellerAuth, /not by profiles\.role/);

assert.match(guardMigration, /new\.role := old\.role/);
assert.match(
  guardMigration,
  /v_role not in \('client', 'driver', 'restaurant', 'seller'\)/,
);

console.log("signupPublicRole.regression.test.ts — PASS");
