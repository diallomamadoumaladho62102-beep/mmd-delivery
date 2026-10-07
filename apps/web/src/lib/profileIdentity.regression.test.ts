import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  applyOwnedDetail,
  applyProfileInsert,
  rejectPrivilegedSignupRole,
  roleFromSignupMetadata,
  type OwnedDetailKind,
} from "./profileIdentity";

const root = path.join(process.cwd(), "../..");
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20261214120000_profiles_one_user_one_profile.sql"),
  "utf8",
);
const handleNewUser = fs.readFileSync(
  path.join(root, "supabase/migrations/20261212120000_signup_public_role_from_auth_metadata.sql"),
  "utf8",
);
const clientAuth = fs.readFileSync(
  path.join(root, "apps/mobile/src/screens/ClientAuthScreen.tsx"),
  "utf8",
);
const clientSignup = fs.readFileSync(
  path.join(root, "apps/web/app/signup/client/page.tsx"),
  "utf8",
);
const navigator = fs.readFileSync(
  path.join(root, "apps/mobile/src/navigation/AppNavigator.tsx"),
  "utf8",
);

const userA = "11111111-1111-4111-8111-111111111111";
const userB = "22222222-2222-4222-8222-222222222222";

const created = applyProfileInsert([], {
  id: userA,
  role: "client",
  fullName: "A Client",
  email: "a@example.com",
});
assert.equal(created.length, 1);
assert.equal(created[0]?.id, userA);
assert.equal(created[0]?.role, "client");

let repeated = created;
for (let i = 0; i < 5; i += 1) {
  repeated = applyProfileInsert(repeated, {
    id: userA,
    role: "driver",
    fullName: "A Client",
    phone: "+15550001111",
  });
}
assert.equal(repeated.length, 1);
assert.equal(repeated[0]?.role, "client");
assert.equal(repeated[0]?.phone, "+15550001111");

const legacy = applyProfileInsert(repeated, {
  id: userA,
  role: "admin",
  email: "a@example.com",
});
assert.equal(legacy.length, 1);
assert.equal(legacy[0]?.role, "client");

const switched = applyProfileInsert(legacy, {
  id: userB,
  role: "client",
  fullName: "B Client",
  email: "b@example.com",
});
assert.equal(switched.filter((row) => row.id === userB).length, 1);
assert.equal(switched.filter((row) => row.id === userA)[0]?.fullName, "A Client");
assert.notEqual(switched.find((row) => row.id === userB)?.email, "a@example.com");

assert.equal(roleFromSignupMetadata("client"), "client");
assert.equal(roleFromSignupMetadata("driver"), "driver");
assert.equal(roleFromSignupMetadata("restaurant"), "restaurant");
assert.equal(roleFromSignupMetadata("seller"), "client");
assert.equal(roleFromSignupMetadata("super_admin"), "client");
assert.equal(rejectPrivilegedSignupRole("admin"), true);
assert.equal(rejectPrivilegedSignupRole("super_admin"), true);
assert.equal(rejectPrivilegedSignupRole("client"), false);

assert.match(handleNewUser, /insert into public\.profiles \(id, email, role\)/);
assert.match(handleNewUser, /values \(new\.id, new\.email, v_role\)/);
assert.match(handleNewUser, /on conflict \(id\) do nothing/);
assert.match(migration, /profiles_id_auth_users_fkey/);
assert.match(migration, /references auth\.users \(id\) on delete cascade/);
assert.match(migration, /return null/);
assert.match(migration, /profile_id_must_match_auth_uid/);
assert.doesNotMatch(migration, /new\.role\s*:=/);
assert.match(migration, /diagnose_canonical_profile/);
assert.match(migration, /revoke all on function public\.diagnose_canonical_profile/);
assert.match(clientAuth, /onConflict:\s*"id"/);
assert.match(clientAuth, /onConflict:\s*"user_id"/);
assert.match(clientSignup, /onConflict:\s*"id"/);
assert.doesNotMatch(clientAuth, /auth\.admin\.createUser/);
assert.doesNotMatch(clientSignup, /auth\.admin\.createUser/);
assert.match(navigator, /getSelectedRoleForUser\(uid\)/);
assert.match(navigator, /profile\?\.full_name/);
const home = fs.readFileSync(
  path.join(root, "apps/mobile/src/screens/ClientHomeScreen.tsx"),
  "utf8",
);
const profileScreen = fs.readFileSync(
  path.join(root, "apps/mobile/src/screens/ClientProfileScreen.tsx"),
  "utf8",
);
assert.match(home, /baseRow\?\.full_name \|\| clientRow\?\.full_name/);
assert.match(profileScreen, /baseProfile\?\.full_name \?\? row\?\.full_name/);
assert.doesNotMatch(home, /clientRow\?\.full_name \|\| baseRow\?\.full_name/);

const driverAuth = fs.readFileSync(
  path.join(root, "apps/mobile/src/screens/DriverAuthScreen.tsx"),
  "utf8",
);
const restaurantAuth = fs.readFileSync(
  path.join(root, "apps/mobile/src/screens/RestaurantAuthScreen.tsx"),
  "utf8",
);
const sellerApi = fs.readFileSync(
  path.join(root, "apps/mobile/src/lib/sellerApi.ts"),
  "utf8",
);
const driverGuard = fs.readFileSync(
  path.join(root, "supabase/migrations/20261213120000_driver_review_lifecycle.sql"),
  "utf8",
);
const authRole = fs.readFileSync(
  path.join(root, "apps/mobile/src/lib/authRole.ts"),
  "utf8",
);

for (const kind of [
  "client_profiles",
  "driver_profiles",
  "restaurant_profiles",
  "sellers",
] as OwnedDetailKind[]) {
  let rows = applyOwnedDetail([], userA, { userId: userA, kind }).rows;
  for (let i = 0; i < 5; i += 1) {
    const next = applyOwnedDetail(rows, userA, { userId: userA, kind });
    assert.equal(next.rejected, false);
    rows = next.rows;
  }
  assert.equal(rows.length, 1);
  const cross = applyOwnedDetail(rows, userB, { userId: userA, kind });
  assert.equal(cross.rejected, true);
  assert.equal(cross.rows.length, 1);
  assert.equal(cross.rows[0]?.userId, userA);
}

assert.match(driverAuth, /onConflict:\s*"id"/);
assert.match(driverAuth, /onConflict:\s*"user_id"/);
assert.match(driverAuth, /id:\s*uid/);
assert.match(driverAuth, /user_id:\s*uid/);
assert.doesNotMatch(driverAuth, /auth\.admin\.createUser/);
assert.match(driverGuard, /new\.status := old\.status/);
assert.match(restaurantAuth, /if \(!existingProfile\)/);
assert.match(restaurantAuth, /if \(!existingRestaurantProfile && createRestaurantProfileIfMissing\)/);
assert.match(restaurantAuth, /user_id: userId/);
assert.doesNotMatch(restaurantAuth, /auth\.admin\.createUser/);
assert.match(sellerApi, /onConflict:\s*"user_id"/);
assert.match(sellerApi, /user_id: userId/);
assert.doesNotMatch(sellerApi, /auth\.admin\.createUser/);
assert.match(authRole, /clearManualClientScope/);
assert.match(authRole, /clearMarketplaceSessionScope/);

console.log("profileIdentity.regression.test.ts — PASS");
