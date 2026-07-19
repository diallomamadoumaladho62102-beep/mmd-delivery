/**
 * Idempotent taxi_promotions → marketing bridge runner.
 * Dry-run by default. Does not apply Production migrations.
 *
 * Usage (when shell available):
 *   node apps/web/scripts/bridge-taxi-legacy-promotions.mjs
 *   DRY_RUN=0 node apps/web/scripts/bridge-taxi-legacy-promotions.mjs
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dryRun = process.env.DRY_RUN !== "0";
const limit = Number(process.env.LIMIT ?? 200);

if (!url || !key) {
  console.error("Missing SUPABASE URL or SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });
const { data, error } = await supabase.rpc("mmd_marketing_bridge_taxi_promotions", {
  p_dry_run: dryRun,
  p_limit: limit,
});

if (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(JSON.stringify({ dry_run: dryRun, report: data }, null, 2));
