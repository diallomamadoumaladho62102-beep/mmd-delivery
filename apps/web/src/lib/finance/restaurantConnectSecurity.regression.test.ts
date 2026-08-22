import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "../../..");
const repoRoot = path.resolve(webRoot, "../..");

function readRepo(rel: string) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

const protect = readRepo(
  "supabase/migrations/20261121180000_protect_restaurant_stripe_connect_columns.sql",
);
assert.match(protect, /restaurant_profiles_protect_stripe_columns/);
assert.match(protect, /new\.stripe_account_id := old\.stripe_account_id/);
assert.match(protect, /new\.stripe_charges_enabled := old\.stripe_charges_enabled/);
assert.match(protect, /new\.stripe_payouts_enabled := old\.stripe_payouts_enabled/);
assert.match(protect, /new\.stripe_onboarded := old\.stripe_onboarded/);
assert.match(protect, /auth\.role\(\) = 'service_role'/);

const onboardedCol = readRepo(
  "supabase/migrations/20261121190000_restaurant_stripe_onboarded_column.sql",
);
assert.match(onboardedCol, /add column if not exists stripe_onboarded/);

const createConnect = readRepo("supabase/functions/create_connect_account/index.ts");
assert.match(createConnect, /type: "express"/);
assert.match(createConnect, /accountLinks\.create/);
assert.match(createConnect, /roleRaw === "restaurant"/);
assert.doesNotMatch(createConnect, /routing_number|account_number|iban/i);

const transfers = readRepo("apps/web/app/api/stripe/transfers/run/route.ts");
assert.match(transfers, /restaurant_connect_account_missing/);
assert.match(transfers, /already_succeeded/);

const earnings = readRepo("apps/mobile/src/screens/RestaurantEarningsScreen.tsx");
assert.doesNotMatch(earnings, /restaurant_paid_out:\s*true/);
assert.doesNotMatch(earnings, /\.update\(\s*\{[^}]*stripe_account_id/);

const card = readRepo(
  "apps/mobile/src/features/restaurant/components/RestaurantStripeConnectCard.tsx",
);
assert.match(card, /startStripeOnboarding\("restaurant"\)/);
assert.doesNotMatch(card, /TextInput/);

console.log("restaurantConnectSecurity regression passed");
