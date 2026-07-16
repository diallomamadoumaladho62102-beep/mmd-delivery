import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { isRestaurantWithinOpeningHours } from "./restaurantOpeningHours";
import { assertRestaurantCanAcceptOrders } from "./restaurantAcceptGate";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
);

test("opening hours helper blocks outside window", () => {
  const hours = { monday: { open: "09:00", close: "17:00" } };
  const mondayMorning = new Date("2026-07-13T10:00:00"); // Monday
  const mondayEvening = new Date("2026-07-13T20:00:00");
  assert.equal(isRestaurantWithinOpeningHours(hours, mondayMorning), true);
  assert.equal(isRestaurantWithinOpeningHours(hours, mondayEvening), false);
});

test("accept gate requires approved + accepting + not busy + hours", async () => {
  const supabase = {
    from() {
      const builder: any = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        maybeSingle: async () => ({
          data: {
            user_id: "r1",
            restaurant_name: "Probe",
            status: "approved",
            is_accepting_orders: true,
            is_busy: true,
            opening_hours: { monday: { open: "00:00", close: "23:59" } },
          },
          error: null,
        }),
      };
      return builder;
    },
  };

  const result = await assertRestaurantCanAcceptOrders(supabase as any, "r1");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error, "restaurant_busy");
});

test("food create/quote use restaurant accept gate", () => {
  const createRoute = fs.readFileSync(
    path.join(repoRoot, "apps/web/app/api/orders/food/create/route.ts"),
    "utf8",
  );
  const quoteRoute = fs.readFileSync(
    path.join(repoRoot, "apps/web/app/api/orders/food/quote/route.ts"),
    "utf8",
  );
  assert.match(createRoute, /assertRestaurantCanAcceptOrders/);
  assert.match(quoteRoute, /assertRestaurantCanAcceptOrders/);
});

test("restaurant cancel defers stripe money movement", () => {
  const cancelRoute = fs.readFileSync(
    path.join(repoRoot, "apps/web/app/api/orders/cancel/route.ts"),
    "utf8",
  );
  assert.match(cancelRoute, /stripe_refund_deferred:\s*true/);
  assert.match(cancelRoute, /refund:\s*"REQUIRED"/);
  assert.doesNotMatch(
    cancelRoute.slice(cancelRoute.indexOf('if (role === "restaurant")')),
    /Order refused by restaurant\. Full refund processed/,
  );
});

test("web profile save no longer hardcodes pending for approved restaurants", () => {
  const page = fs.readFileSync(
    path.join(repoRoot, "apps/web/app/restaurant/profile/page.tsx"),
    "utf8",
  );
  assert.match(page, /existingStatus === "approved"/);
  assert.doesNotMatch(page, /opening_hours: openingHours,\s*status: "pending"/);
});

test("phase4 migration hardens restaurant RLS and busy/cover", () => {
  const sql = fs.readFileSync(
    path.join(
      repoRoot,
      "supabase/migrations/20260816120000_restaurant_phase4_production_hardening.sql",
    ),
    "utf8",
  );
  assert.match(sql, /is_busy/);
  assert.match(sql, /cover_image_url/);
  assert.match(sql, /menu_categories/);
  assert.match(sql, /restaurant-menu owner insert/);
  assert.match(sql, /guard_restaurant_profile_self_update/);
});

test("menu image upload targets restaurant_items", () => {
  const upload = fs.readFileSync(
    path.join(repoRoot, "apps/mobile/src/lib/uploadMenuItemImage.ts"),
    "utf8",
  );
  assert.match(upload, /restaurant_items/);
  assert.doesNotMatch(upload, /restaurant_menu_items/);
});

test("unavailable items require is_available === true", () => {
  const pricing = fs.readFileSync(
    path.join(repoRoot, "apps/web/src/lib/foodOrderServerPricing.ts"),
    "utf8",
  );
  assert.match(pricing, /fresh\.is_available !== true/);
  assert.match(pricing, /stock_qty/);
  assert.match(pricing, /resolveSelectedMenuOptionExtras/);
  assert.match(pricing, /taxi_country_taxes:food/);
  assert.doesNotMatch(pricing, /taxi_country_taxes:ride/);
});

test("menu option extras resolve against catalog", async () => {
  const { resolveSelectedMenuOptionExtras } = await import("./foodOrderServerPricing");
  const catalog = [
    { id: "extra-cheese", name: "Extra cheese", price_cents: 150 },
    { id: "no-onion", name: "Sans oignon", price_cents: 0 },
  ];
  const resolved = resolveSelectedMenuOptionExtras(catalog, ["extra-cheese"]);
  assert.equal(resolved.extrasCents, 150);
  assert.equal(resolved.selected.length, 1);
  assert.throws(() => resolveSelectedMenuOptionExtras(catalog, ["unknown"]));
});

test("cover upload surfaces exist on web profile and mobile setup", () => {
  const webProfile = fs.readFileSync(
    path.join(repoRoot, "apps/web/app/restaurant/profile/page.tsx"),
    "utf8",
  );
  const mobileSetup = fs.readFileSync(
    path.join(repoRoot, "apps/mobile/src/screens/restaurant/RestaurantSetupScreen.tsx"),
    "utf8",
  );
  assert.match(webProfile, /cover_image_url/);
  assert.match(webProfile, /uploadCover/);
  assert.match(mobileSetup, /cover_image_url/);
  assert.match(mobileSetup, /pickRestaurantCover/);
});

test("mobile menu persists stock_qty and options_json", () => {
  const menu = fs.readFileSync(
    path.join(repoRoot, "apps/mobile/src/screens/restaurant/RestaurantMenuScreen.tsx"),
    "utf8",
  );
  assert.match(menu, /stock_qty/);
  assert.match(menu, /options_json/);
  assert.match(menu, /parseOptionsText/);
});
