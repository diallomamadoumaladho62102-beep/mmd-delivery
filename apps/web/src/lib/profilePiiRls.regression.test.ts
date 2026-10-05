import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const sql = fs.readFileSync(
  path.join(
    process.cwd(),
    "../../supabase/migrations/20261211120000_restrict_cross_user_profile_pii.sql",
  ),
  "utf8",
);

test("cross-user restaurant profile policy is removed", () => {
  assert.match(
    sql,
    /drop policy if exists "Allow all users to read restaurant profiles" on public\.profiles/i,
  );
});

test("restaurant tax, license, email, and Stripe fields are not publicly selectable", () => {
  assert.match(sql, /revoke select on table public\.restaurant_profiles from anon, authenticated/i);
  const grant = sql.match(
    /grant select \(([\s\S]*?)\) on table public\.restaurant_profiles/i,
  );
  assert.ok(grant);
  assert.doesNotMatch(grant[1], /\bemail\b/);
  assert.doesNotMatch(grant[1], /\btax_id\b/);
  assert.doesNotMatch(grant[1], /\blicense_number\b/);
  assert.doesNotMatch(grant[1], /\bstripe_account_id\b/);
  assert.doesNotMatch(grant[1], /\bexpo_push_token\b/);
  assert.match(sql, /auth\.uid\(\) = p_user_id/);
  assert.match(sql, /is_staff_user\(auth\.uid\(\)\)/);
});
