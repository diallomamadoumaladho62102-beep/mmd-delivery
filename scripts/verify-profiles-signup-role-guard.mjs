#!/usr/bin/env node
/**
 * Post-migration validation for profiles signup role guard.
 * Run against production Supabase SQL editor after applying 20260731300000.
 */
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const migrationPath = path.join(
  repoRoot,
  "supabase/migrations/20260731300000_fix_profiles_signup_role_guard.sql"
);

if (!fs.existsSync(migrationPath)) {
  console.error("Missing migration:", migrationPath);
  process.exit(1);
}

const sql = fs.readFileSync(migrationPath, "utf8");
const checks = [
  ["allows self-service roles", /new\.role not in \('client', 'driver', 'restaurant'\)/.test(sql)],
  ["blocks staff escalation on insert", /new\.is_founder := false/.test(sql)],
  ["preserves role on update", /new\.role := old\.role/.test(sql)],
];

let failed = 0;
for (const [label, ok] of checks) {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) failed += 1;
}

console.log("\nRun these SQL checks in production after supabase db push:\n");
console.log(`-- 1) Trigger function allows driver/restaurant on INSERT
select pg_get_functiondef('public.guard_profiles_privilege_columns()'::regprocedure) ilike '%client%, ''driver'', ''restaurant''%';

-- 2) No driver/restaurant profile downgraded to client (sample)
select role, count(*)
from public.profiles
where role in ('client','driver','restaurant')
group by role
order by role;

-- 3) Drivers with driver_profiles but client role (should be 0)
select count(*)
from public.driver_profiles dp
join public.profiles p on p.id = dp.user_id
where p.role <> 'driver';

-- 4) Restaurants with restaurant_profiles but client role (should be 0)
select count(*)
from public.restaurant_profiles rp
join public.profiles p on p.id = rp.user_id
where p.role <> 'restaurant';

-- 5) No non-staff profiles with privileged roles
select count(*)
from public.profiles
where role in ('admin','ops','support','finance','review')
  and not exists (
    select 1 from public.profiles staff
    where staff.id = profiles.id and public.is_staff_user()
  );
`);

process.exit(failed > 0 ? 1 : 0);
