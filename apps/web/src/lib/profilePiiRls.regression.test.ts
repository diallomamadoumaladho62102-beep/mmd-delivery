import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(process.cwd(), "../..");

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

test("participant profile reads do not request another user's email", () => {
  const files = [
    "apps/mobile/src/screens/ClientOrderDetailsScreen.tsx",
    "apps/mobile/src/screens/ClientDeliveryRequestDetailsScreen.tsx",
    "apps/mobile/src/screens/DriverOrderDetailsScreen.tsx",
    "apps/web/src/components/OrderItemsCard.tsx",
  ];
  for (const relative of files) {
    const text = fs.readFileSync(path.join(repoRoot, relative), "utf8");
    assert.doesNotMatch(text, /from\("profiles"\)[\s\S]{0,120}\.select\("[^"]*email/);
  }
});

test("later migrations do not recreate the blanket restaurant profile read", () => {
  const dir = path.join(repoRoot, "supabase", "migrations");
  const later = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => {
      const stamp = name.slice(0, 14);
      return /^\d{14}$/.test(stamp) && stamp > "20261211120000";
    })
    .filter((name) => {
      const text = fs.readFileSync(path.join(dir, name), "utf8");
      return /create policy\s+"Allow all users to read restaurant profiles"/i.test(text);
    });
  assert.deepEqual(later, []);
  const recreate = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .filter((name) => {
      const text = fs.readFileSync(path.join(dir, name), "utf8");
      return /create policy\s+"Allow all users to read restaurant profiles"/i.test(text);
    });
  assert.deepEqual(recreate, []);
});

test("restaurant order contact reads phone and not email", () => {
  const text = fs.readFileSync(
    path.join(repoRoot, "apps/mobile/src/screens/RestaurantOrderDetailsScreen.tsx"),
    "utf8",
  );
  assert.match(text, /\.select\("id, full_name, phone"\)/);
  assert.doesNotMatch(text, /from\("profiles"\)[\s\S]{0,180}\.select\("[^"]*email/);
});

test("own profile still reads email, so a live column revoke would break shipped clients", () => {
  const clientProfile = fs.readFileSync(
    path.join(repoRoot, "apps/mobile/src/screens/ClientProfileScreen.tsx"),
    "utf8",
  );
  const navigator = fs.readFileSync(
    path.join(repoRoot, "apps/mobile/src/navigation/AppNavigator.tsx"),
    "utf8",
  );
  assert.match(clientProfile, /\.select\("full_name, phone, phone_e164, phone_verified_at, email, avatar_url"\)/);
  assert.match(navigator, /\.select\("email, phone_verified_at, phone, phone_e164"\)/);
});
