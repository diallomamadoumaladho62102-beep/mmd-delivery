import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../../..");
const webRoot = path.resolve(__dirname, "../..");
const mobileRoot = path.resolve(__dirname, "../../../mobile");

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

const harden = fs.readFileSync(
  path.join(
    root,
    "supabase/migrations/20261116140000_taxi_rating_compat_harden.sql",
  ),
  "utf8",
);

const ratingRoute = fs.readFileSync(
  path.join(webRoot, "app/api/taxi/rides/[id]/rating/route.ts"),
  "utf8",
);

const taxiRatingsMig = fs.readFileSync(
  path.join(root, "supabase/migrations/20261115130000_taxi_ride_ratings.sql"),
  "utf8",
);

test("harden migration is additive: no destructive drops of data/tables", () => {
  assert.doesNotMatch(harden, /\bdrop table\b/i);
  assert.doesNotMatch(harden, /\btruncate\b/i);
  assert.doesNotMatch(harden, /\bdelete from public\.driver_ratings\b/i);
  assert.match(harden, /alter column order_id drop not null/i);
  assert.match(harden, /preserves all existing driver_ratings rows/i);
});

test("harden keeps rater_user_id and adds taxi_ride_id without replacing legacy", () => {
  assert.match(harden, /rater_user_id/);
  assert.match(harden, /taxi_ride_id/);
  assert.match(harden, /order_id = null/);
  assert.match(harden, /driver_ratings_source_coherence_chk/);
  assert.match(harden, /preflight failed/);
});

test("summary VIEW includes food driver_ratings + reviews + taxi (no taxi double-count)", () => {
  assert.match(harden, /from public\.driver_reviews dr/i);
  assert.match(harden, /from public\.driver_ratings d/i);
  assert.match(harden, /d\.taxi_ride_id is null/i);
  assert.match(harden, /d\.order_id is not null/i);
  assert.match(harden, /from public\.taxi_ride_ratings tr/i);
  assert.match(harden, /create or replace view public\.driver_rating_summary/i);
});

test("trigger mirrors taxi with order_id null and refreshes profiles", () => {
  assert.match(harden, /apply_taxi_ride_rating_to_driver_summary/);
  assert.match(harden, /new\.taxi_ride_id,\s*\n\s*null/m);
  assert.match(harden, /perform public\.refresh_driver_rating/);
  assert.match(harden, /rating_taxi/);
  assert.match(harden, /from public\.taxi_ride_ratings/);
});

test("anti-double rating: taxi unique + driver_ratings taxi_ride unique index", () => {
  assert.match(
    taxiRatingsMig,
    /constraint taxi_ride_ratings_unique_ride_rater unique \(taxi_ride_id, rater_id\)/i,
  );
  assert.match(harden, /driver_ratings_taxi_ride_uq/);
  assert.match(ratingRoute, /rating_already_exists/);
  assert.match(ratingRoute, /23505/);
});

test("ownership: rating API requires client owns ride + completed", () => {
  assert.match(ratingRoute, /assertClientOwnsTaxiRide/);
  assert.match(ratingRoute, /ride_not_completed/);
  assert.match(ratingRoute, /rating_must_be_1_to_5/);
  assert.match(ratingRoute, /driver_id/);
  assert.match(ratingRoute, /rater_id: auth\.user\.id/);
});

test("legacy Driver Menu still reads summary then driver_ratings fallback", () => {
  const menu = fs.readFileSync(
    path.join(mobileRoot, "src/screens/DriverMenuScreen.tsx"),
    "utf8",
  );
  assert.match(menu, /driver_rating_summary/);
  assert.match(menu, /driver_ratings/);
  assert.match(menu, /ratee_driver_id/);
});

test("refresh_driver_rating uses combined sources like the VIEW", () => {
  assert.match(harden, /create or replace function public\.refresh_driver_rating/);
  assert.match(harden, /from public\.driver_reviews/);
  assert.match(harden, /from public\.driver_ratings/);
  assert.match(harden, /from public\.taxi_ride_ratings/);
});

console.log("taxiRatingCompatHarden.regression passed");
