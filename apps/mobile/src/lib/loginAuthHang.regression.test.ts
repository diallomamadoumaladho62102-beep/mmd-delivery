import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Apple Guideline 2.1(a) — build 1.0 (79) stayed on login forever on
 * iPhone 17 Pro Max / iOS 26.6.1. These source invariants must stay true
 * so Splash / Login / post-login cannot wait on a hung promise.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(here, "../..");

function read(rel: string): string {
  return fs.readFileSync(path.join(mobileRoot, rel), "utf8");
}

const app = read("App.tsx");
const shell = read("src/components/AppRootShell.tsx");
const stripe = read("src/lib/StripeGate.tsx");
const nav = read("src/navigation/AppNavigator.tsx");
const clientAuth = read("src/screens/ClientAuthScreen.tsx");
const driverAuth = read("src/screens/DriverAuthScreen.tsx");
const restaurantAuth = read("src/screens/RestaurantAuthScreen.tsx");
const roleSelect = read("src/screens/RoleSelectScreen.tsx");
const home = read("src/screens/ClientHomeScreen.tsx");
const incoming = read("src/components/calls/IncomingMaskedCallHost.tsx");
const sentry = read("src/lib/sentry.ts");
const signOut = read("src/lib/signOutToRoleSelect.ts");
const aiApi = read("src/lib/mmdAiApi.ts");

assert.match(app, /withTimeout\(\s*supabase\.auth\.getSession\(\)/);
assert.match(app, /BOOT_AUTH_TIMEOUT_MS/);
assert.match(app, /finally \{\s*if \(isMounted\) setAuthLoading\(false\);/);
assert.match(app, /onAuthStateChange/);
assert.match(app, /setAuthLoading\(false\)/);
assert.doesNotMatch(app, /void mmdAudio\.init\(/);

assert.match(shell, /BOOT_SHELL_TIMEOUT_MS/);
assert.match(shell, /shell_import/);

assert.match(stripe, /stripe_getSession/);
assert.match(stripe, /BOOT_AUTH_TIMEOUT_MS/);
assert.match(stripe, /if \(!hasSession\)/);

assert.match(nav, /nav_getSession/);
assert.match(nav, /nav_sync/);
assert.match(nav, /nav_getUser/);
assert.match(nav, /AppNavigator sync fail-open/);

assert.match(clientAuth, /client_signIn/);
assert.match(clientAuth, /AUTH_ACTION_TIMEOUT_MS/);
assert.match(clientAuth, /client_login_referral/);
assert.match(clientAuth, /resolvePostAuthRoute/);
assert.match(clientAuth, /setLoading\(false\)/);
assert.doesNotMatch(clientAuth, /if \(loading\) \{\s*return \(/);

assert.match(driverAuth, /driver_signIn/);
assert.match(driverAuth, /driver_boot_getSession/);
assert.match(driverAuth, /driver_getUser/);
assert.match(driverAuth, /driver_route_getUser/);
assert.match(driverAuth, /driver_route_profile/);
assert.match(driverAuth, /routeAfterAuth fail-open/);
assert.doesNotMatch(driverAuth, /if \(loading\) \{\s*return \(/);

assert.match(restaurantAuth, /restaurant_signIn/);
assert.match(restaurantAuth, /restaurant_ensureAccount/);
assert.match(restaurantAuth, /setLoading\(false\)/);

assert.match(roleSelect, /roleSelect_getSession/);
assert.match(roleSelect, /roleSelect_routeLoggedIn/);

assert.match(home, /CLIENT_HOME_FETCH_TIMEOUT_MS/);
assert.match(home, /client_home_fetch/);
assert.match(home, /setLoading\(false\)/);

assert.match(incoming, /incoming_getSession/);
assert.match(incoming, /createIncomingCallFetchGate/);
assert.match(incoming, /INCOMING_CALL_POLL_MS/);

assert.match(sentry, /enableAppHangTracking:\s*true/);
assert.doesNotMatch(sentry, /enableAppHangTracking:\s*false/);

assert.match(signOut, /AUTH_ACTION_TIMEOUT_MS/);
assert.match(signOut, /withTimeout/);

assert.match(aiApi, /mmd_ai_getSession/);
assert.match(aiApi, /mmd_ai_chat/);
assert.match(aiApi, /fetchWithTimeout/);

console.log("loginAuthHang.regression.test.ts OK");
