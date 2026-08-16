import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../../../..");
const webRoot = path.resolve(__dirname, "../..");

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

test("rating migration wires taxi ratings into driver_rating_summary", () => {
  const mig = fs.readFileSync(
    path.join(
      root,
      "supabase/migrations/20261116120000_taxi_rating_driver_summary.sql",
    ),
    "utf8",
  );
  assert.match(mig, /driver_rating_summary/);
  assert.match(mig, /apply_taxi_ride_rating_to_driver_summary/);
  assert.match(mig, /after insert on public\.taxi_ride_ratings/i);
  assert.match(mig, /rating_count/);
});

test("compat harden keeps food driver_ratings visible in summary VIEW", () => {
  const mig = fs.readFileSync(
    path.join(
      root,
      "supabase/migrations/20261116140000_taxi_rating_compat_harden.sql",
    ),
    "utf8",
  );
  assert.match(mig, /from public\.driver_ratings d/i);
  assert.match(mig, /taxi_ride_id is null/i);
  assert.match(mig, /alter column order_id drop not null/i);
  assert.doesNotMatch(mig, /\bdelete from public\.driver_ratings\b/i);
});

test("rating API returns driver_rating_summary after create", () => {
  const src = fs.readFileSync(
    path.join(webRoot, "app/api/taxi/rides/[id]/rating/route.ts"),
    "utf8",
  );
  assert.match(src, /driver_rating_summary/);
  assert.match(src, /rating_already_exists/);
  assert.match(src, /rating_must_be_1_to_5/);
});

test("taxi monitoring is owned by pg_cron daily maintenance not Vercel", () => {
  const route = fs.readFileSync(
    path.join(webRoot, "app/api/cron/taxi-monitoring-snapshot/route.ts"),
    "utf8",
  );
  assert.match(route, /mmd-db-daily-maintenance/);
  assert.match(route, /Do NOT add this route to Vercel/);

  const vercel = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
  assert.doesNotMatch(vercel, /taxi-monitoring-snapshot/);

  const consolidation = fs.readFileSync(
    path.join(
      root,
      "supabase/migrations/20260907120000_mmd_cron_consolidation.sql",
    ),
    "utf8",
  );
  assert.match(consolidation, /refresh_taxi_monitoring_snapshot/);
  assert.match(consolidation, /mmd-db-daily-maintenance/);
});

console.log("taxiRatingMonitoring.regression passed");
