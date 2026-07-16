import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const webRoot = process.cwd();
const repoRoot = join(webRoot, "..", "..");

function readWeb(rel: string) {
  return readFileSync(join(webRoot, rel), "utf8");
}

function readRepo(rel: string) {
  return readFileSync(join(repoRoot, rel), "utf8");
}

// Memory cache + Mapbox places cache wiring
{
  assert.match(readWeb("src/lib/memoryCache.ts"), /cacheWrap/);
  assert.match(readWeb("app/api/mapbox/places/route.ts"), /cacheWrap/);
  assert.match(readWeb("app/api/mapbox/places/route.ts"), /max-age=30/);
}

// Taxi categories batch RPC (no N+1 map of RPCs)
{
  const route = readWeb("app/api/taxi/categories/available/route.ts");
  assert.match(route, /count_taxi_eligible_drivers_all_categories/);
  assert.doesNotMatch(route, /TAXI_CATEGORIES\.map\(async/);
}

// Admin clients batch email lookup
{
  const route = readWeb("app/api/admin/clients/route.ts");
  assert.match(route, /admin_lookup_user_emails/);
  assert.doesNotMatch(route, /getUserById/);
}

// Next perf config
{
  const cfg = readWeb("next.config.js");
  assert.match(cfg, /compress:\s*true/);
  assert.match(cfg, /images:\s*\{/);
  assert.match(cfg, /remotePatterns/);
}

// Migration present
{
  const mig = readRepo(
    "supabase/migrations/20260821120000_phase9_performance_hot_paths.sql"
  );
  assert.match(mig, /count_taxi_eligible_drivers_all_categories/);
  assert.match(mig, /seller_orders_seller_status_created_idx/);
  assert.match(mig, /admin_lookup_user_emails/);
}

// Mobile lazy navigator + list perf
{
  const nav = readRepo("apps/mobile/src/navigation/AppNavigator.tsx");
  assert.match(nav, /getComponent=\{/);
  assert.ok(
    (nav.match(/getComponent=\{/g) || []).length >= 50,
    "expected many lazy screens"
  );
  assert.ok(existsSync(join(repoRoot, "apps/mobile/src/lib/listPerf.ts")));
}

// Scripts exist
{
  assert.ok(existsSync(join(repoRoot, "scripts/lighthouse-smoke.mjs")));
  assert.ok(existsSync(join(repoRoot, "scripts/bundle-size-report.mjs")));
}

console.log("phase9Performance tests passed");
