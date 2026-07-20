import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  canConvert,
  convertibleBlocks,
  creditCentsForBlocks,
  nextTier,
  resolveTier,
  DEFAULT_LOYALTY_SETTINGS,
} from "./loyalty/loyaltyProgram";

const root = path.resolve(__dirname, "../../../..");

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

test("home rewards uses loyalty API balance (no delivered*10)", () => {
  const home = read("apps/mobile/src/screens/ClientHomeScreen.tsx");
  assert.match(home, /fetchLoyaltySummary\("client"\)/);
  assert.match(home, /loyaltySummary\?\.points_balance/);
  assert.doesNotMatch(home, /delivered \* 10/);
  assert.doesNotMatch(home, /inProgress \* 2/);
  assert.match(home, /onNavigateMmdPlus/);
  assert.match(home, /available_credit_cents/);
});

test("order details no longer invents local tier progress", () => {
  const details = read("apps/mobile/src/screens/ClientOrderDetailsScreen.tsx");
  assert.doesNotMatch(details, /basePoints\s*=/);
  assert.doesNotMatch(details, /levelName\s*=\s*total\s*>=\s*120/);
  assert.doesNotMatch(details, /loyalty\.levelName/);
  assert.match(details, /Open MMD Rewards|openRewards/);
});

test("loyalty hub shows conversion rate, rewards, history, progress", () => {
  const loyalty = read("apps/mobile/src/screens/LoyaltyScreen.tsx");
  assert.match(loyalty, /loyalty-points-hero/);
  assert.match(loyalty, /conversion_points/);
  assert.match(loyalty, /conversion_credit_cents/);
  assert.match(loyalty, /tier_progress_pct|progressFill/);
  assert.match(loyalty, /loyalty-rewards/);
  assert.match(loyalty, /Points history|loyalty\.history/);
  assert.match(loyalty, /convertLoyaltyPoints/);
  assert.match(loyalty, /converting\) return/);
  assert.match(loyalty, /loyalty-error|loadError/);
  assert.match(loyalty, /navigate\("MmdPlus"\)/);
});

test("mmd plus join/manage wired to production actions API", () => {
  const screen = read("apps/mobile/src/screens/MmdPlusScreen.tsx");
  const api = read("apps/mobile/src/lib/mmdPlusApi.ts");
  assert.match(api, /\/api\/mmd-plus\/summary/);
  assert.match(api, /\/api\/mmd-plus\/actions/);
  assert.doesNotMatch(api, /sk_live_|sk_test_/);
  assert.match(screen, /Manage Subscription/);
  assert.match(screen, /Join/);
  assert.match(screen, /run\("checkout"/);
  assert.match(screen, /run\("portal"/);
  assert.match(screen, /price_cents/);
});

test("navigation: LoyaltyHub/Promotions fall back to ClientHome", () => {
  const policy = read("apps/mobile/src/navigation/navigationBackPolicy.ts");
  assert.match(policy, /LoyaltyHub/);
  assert.match(policy, /Promotions/);
  const nav = read("apps/mobile/src/navigation/AppNavigator.tsx");
  assert.match(nav, /name="LoyaltyHub"/);
  assert.match(nav, /name="MmdPlus"/);
});

test("conversion math: 100 pts = $5 and no double block without balance", () => {
  assert.equal(DEFAULT_LOYALTY_SETTINGS.conversionPoints, 100);
  assert.equal(DEFAULT_LOYALTY_SETTINGS.conversionCreditCents, 500);
  assert.equal(canConvert(99, 100), false);
  assert.equal(canConvert(100, 100), true);
  assert.equal(convertibleBlocks(250, 100), 2);
  assert.equal(creditCentsForBlocks(1, 500), 500);
  // After converting one block from 100, remainder cannot convert again.
  assert.equal(canConvert(0, 100), false);
});

test("tier progress helpers for home progress bar", () => {
  assert.equal(resolveTier(0).code, "bronze");
  assert.equal(resolveTier(100).code, "silver");
  assert.equal(nextTier(100)?.code, "gold");
  assert.equal(nextTier(10_000), null);
});

test("summary API exposes next_tier progress fields", () => {
  const api = read("apps/web/src/lib/loyalty/loyaltyUserApi.ts");
  assert.match(api, /points_to_next_tier/);
  assert.match(api, /tier_progress_pct/);
  assert.match(api, /next_tier/);
});
