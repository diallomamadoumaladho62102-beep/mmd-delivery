#!/usr/bin/env node
/**
 * Production SQL integrity checks via Supabase REST (read-only).
 */
import fs from "node:fs";
import path from "node:path";

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

const repoRoot = path.resolve(import.meta.dirname, "..");
loadEnvFile(path.join(repoRoot, "apps/web/.env.local"));

const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!baseUrl || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

async function restGet(table, query = "select=*") {
  const url = `${baseUrl}/rest/v1/${table}?${query}`;
  const res = await fetch(url, {
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${table} ${res.status}: ${body}`);
  }
  return res.json();
}

async function countRoleMismatch(joinTable, expectedRole) {
  const rows = await restGet(joinTable, "select=user_id");
  let mismatches = 0;

  for (const row of rows) {
    const userId = String(row.user_id ?? "");
    if (!userId) continue;

    const profiles = await restGet("profiles", `select=role&id=eq.${userId}`);
    const role = profiles[0]?.role ?? "";
    if (role !== expectedRole) mismatches += 1;
  }

  return mismatches;
}

async function verifyStripeDuplicates() {
  const rows = await restGet(
    "payment_transactions",
    "select=external_reference&provider=eq.stripe&external_reference=not.is.null"
  );
  const seen = new Set();
  let dupes = 0;
  for (const row of rows) {
    const ref = String(row.external_reference ?? "");
    if (seen.has(ref)) dupes += 1;
    seen.add(ref);
  }
  return dupes;
}

async function main() {
  const checks = [];
  let failed = 0;

  console.log("Production SQL verification (read-only)\n");

  try {
    const driverMismatch = await countRoleMismatch("driver_profiles", "driver");
    checks.push({
      name: "driver_profiles role alignment",
      value: driverMismatch,
      ok: driverMismatch === 0,
    });
  } catch (e) {
    checks.push({ name: "driver_profiles role alignment", ok: false, error: String(e) });
  }

  try {
    const restaurantMismatch = await countRoleMismatch("restaurant_profiles", "restaurant");
    checks.push({
      name: "restaurant_profiles role alignment",
      value: restaurantMismatch,
      ok: restaurantMismatch === 0,
    });
  } catch (e) {
    checks.push({ name: "restaurant_profiles role alignment", ok: false, error: String(e) });
  }

  try {
    const privileged = await restGet(
      "profiles",
      "select=id,role&role=in.(admin,ops,support,finance,review)"
    );
    checks.push({
      name: "privileged role rows (staff review)",
      value: privileged.length,
      ok: true,
    });
  } catch (e) {
    checks.push({ name: "privileged role rows", ok: false, error: String(e) });
  }

  try {
    const dupes = await verifyStripeDuplicates();
    checks.push({
      name: "duplicate stripe external_reference rows",
      value: dupes,
      ok: dupes === 0,
    });
  } catch (e) {
    checks.push({ name: "stripe idempotency data", ok: false, error: String(e) });
  }

  try {
    const roles = await restGet("profiles", "select=role&role=in.(client,driver,restaurant)");
    const tally = {};
    for (const row of roles) {
      const role = String(row.role ?? "unknown");
      tally[role] = (tally[role] ?? 0) + 1;
    }
    checks.push({ name: "profile role distribution", value: tally, ok: true });
  } catch (e) {
    checks.push({ name: "profile role distribution", ok: false, error: String(e) });
  }

  for (const check of checks) {
    const status = check.ok ? "PASS" : "FAIL";
    console.log(`${status} ${check.name}`, check.value ?? check.error ?? "");
    if (!check.ok) failed += 1;
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
