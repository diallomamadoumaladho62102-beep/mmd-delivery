/**
 * Fix import path for shared module when run via tsx from repo root.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isClientProfileComplete } from "../../../../shared/profileCompleteness";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../../../..");

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
}

function read(rel: string): string {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

test("UIBackgroundModes does not declare audio in app.config.ts", () => {
  const src = read("app.config.ts");
  assert.match(
    src,
    /UIBackgroundModes:\s*\[\s*"location"\s*,\s*"remote-notification"\s*\]/,
  );
});

test("mobile app.json UIBackgroundModes excludes audio", () => {
  const json = JSON.parse(read("apps/mobile/app.json"));
  const modes = json?.expo?.ios?.infoPlist?.UIBackgroundModes ?? [];
  assert.ok(Array.isArray(modes));
  assert.ok(modes.includes("location"));
  assert.ok(modes.includes("remote-notification"));
  assert.ok(!modes.includes("audio"));
});

test("iOS locales cover permission purpose strings", () => {
  const langs = ["en", "fr", "es", "ar", "zh", "ff"];
  const keys = [
    "NSCameraUsageDescription",
    "NSPhotoLibraryUsageDescription",
    "NSMicrophoneUsageDescription",
    "NSLocationWhenInUseUsageDescription",
    "NSLocationAlwaysAndWhenInUseUsageDescription",
  ];
  for (const lang of langs) {
    const file = path.join(repoRoot, `apps/mobile/ios-locales/${lang}.json`);
    assert.ok(fs.existsSync(file), `missing ${lang}.json`);
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const key of keys) {
      assert.ok(String(data[key] ?? "").trim().length > 20, `${lang} ${key}`);
    }
    assert.ok(
      !Object.prototype.hasOwnProperty.call(
        data,
        "NSPhotoLibraryAddUsageDescription",
      ),
      `${lang} must not declare unused Photo Library Add`,
    );
  }
});

test("app.config does not declare unused Photo Library Add", () => {
  const src = read("app.config.ts");
  assert.doesNotMatch(src, /NSPhotoLibraryAddUsageDescription/);
});

test("AppNavigator sync uses getSession timeout fail-open", () => {
  const src = read("apps/mobile/src/navigation/AppNavigator.tsx");
  assert.match(src, /nav_getSession|withTimeout/);
  assert.match(src, /BOOT_AUTH_TIMEOUT_MS/);
});

test("Driver/Restaurant auth do not full-screen replace Login while loading", () => {
  const driver = read("apps/mobile/src/screens/DriverAuthScreen.tsx");
  const restaurant = read("apps/mobile/src/screens/RestaurantAuthScreen.tsx");
  assert.doesNotMatch(driver, /if \(loading\) \{\s*return \(/);
  assert.doesNotMatch(restaurant, /if \(loading\) \{\s*return \(/);
  assert.match(driver, /AUTH_ACTION_TIMEOUT_MS/);
  assert.match(restaurant, /AUTH_ACTION_TIMEOUT_MS/);
});

test("ClientAuth does not use expo-linear-gradient native views", () => {
  const src = read("apps/mobile/src/screens/ClientAuthScreen.tsx");
  assert.doesNotMatch(src, /from ["']expo-linear-gradient["']/);
  assert.doesNotMatch(src, /from ["']expo-image-picker["']/);
  assert.doesNotMatch(src, /from ["']expo-file-system/);
  assert.match(src, /SafeLinearGradient/);
  assert.match(src, /AUTH_ACTION_TIMEOUT_MS/);
  assert.match(src, /client_signIn/);
  assert.match(src, /client_signUp/);
  assert.match(src, /client_resetPassword/);
  assert.match(src, /justifyContent:\s*"flex-start"/);
  assert.match(src, /resolvePostAuthRoute/);
  assert.match(src, /postAuthRoute/);
  assert.doesNotMatch(
    src,
    /signUp[\s\S]*routes:\s*\[\s*\{\s*name:\s*"Home"\s*\}\s*\]/,
  );
});

test("completed food orders do not mount Mapbox MapView", () => {
  const src = read("apps/mobile/src/screens/ClientOrderDetailsScreen.tsx");
  assert.doesNotMatch(src, /from ["']@rnmapbox\/maps["']/);
  assert.match(src, /isFinalStatus\(order\.status\)/);
  assert.match(src, /LiveTripMap/);
  assert.match(src, /Delivery completed/);
});

test("Restaurant/Seller gates fail-open with timeout", () => {
  const restaurant = read(
    "apps/mobile/src/screens/restaurant/RestaurantGateScreen.tsx",
  );
  const seller = read("apps/mobile/src/screens/seller/SellerGateScreen.tsx");
  assert.match(restaurant, /BOOT_AUTH_TIMEOUT_MS/);
  assert.match(restaurant, /restaurant_gate/);
  assert.match(seller, /BOOT_AUTH_TIMEOUT_MS/);
  assert.match(seller, /seller_gate/);
  assert.match(seller, /RoleSelect/);
});

test("DriverHelp does not navigate to missing DriverReportIssue", () => {
  const src = read("apps/mobile/src/screens/DriverHelpScreen.tsx");
  assert.doesNotMatch(src, /navigate\(["']DriverReportIssue["']\)/);
});

test("legacy Home route and OrderChat route are removed", () => {
  const nav = read("apps/mobile/src/navigation/AppNavigator.tsx");
  assert.doesNotMatch(nav, /name=["']Home["']/);
  assert.doesNotMatch(nav, /from ["'].*\/HomeScreen["']/);
  assert.doesNotMatch(nav, /import\s*\{\s*HomeScreen\s*\}/);
  assert.equal(
    fs.existsSync(path.join(repoRoot, "apps/mobile/src/screens/HomeScreen.tsx")),
    false,
  );
  assert.equal(
    fs.existsSync(
      path.join(repoRoot, "apps/mobile/src/screens/OrderChatScreen.tsx"),
    ),
    false,
  );
  const driverOrder = read(
    "apps/mobile/src/screens/DriverOrderDetailsScreen.tsx",
  );
  assert.doesNotMatch(driverOrder, /navigate\(["']OrderChat["']/);
});

test("app.json iOS notification sounds exclude >30s clips", () => {
  const json = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "apps/mobile/app.json"), "utf8"),
  );
  const plugin = (json?.expo?.plugins ?? []).find(
    (p: unknown) => Array.isArray(p) && p[0] === "expo-notifications",
  );
  const sounds = plugin?.[1]?.sounds ?? [];
  assert.ok(Array.isArray(sounds));
  for (const s of sounds) {
    assert.ok(
      !String(s).includes("_60s") && !String(s).includes("_120s"),
      `iOS push sound must be ≤30s: ${s}`,
    );
  }
});

test("mmdAudio does not request background audio session", () => {
  const src = read("apps/mobile/src/lib/mmdAudio.ts");
  assert.match(src, /staysActiveInBackground:\s*false/);
});

test("app does not declare App Tracking Transparency / IDFA", () => {
  const appJson = read("apps/mobile/app.json");
  const appConfig = read("app.config.ts");
  assert.doesNotMatch(appJson, /NSUserTrackingUsageDescription/);
  assert.doesNotMatch(appConfig, /NSUserTrackingUsageDescription/);
  assert.doesNotMatch(appJson, /AppTrackingTransparency/);
  assert.doesNotMatch(appConfig, /requestTrackingPermissionsAsync/);
});

test("signup soft-complete without full address", () => {
  assert.equal(
    isClientProfileComplete({
      fullName: "Review User",
      phone: "+15551234567",
    }),
    true,
  );
});

test("marketplace public catalog helper exists", () => {
  const src = read("apps/web/src/lib/marketplaceApiAuth.ts");
  assert.match(src, /allowMarketplacePublicCatalog/);
  assert.match(src, /requireMarketplaceClientAuth/);
});

test("sellers/products routes are guest-browsable", () => {
  assert.match(
    read("apps/web/app/api/marketplace/sellers/route.ts"),
    /allowMarketplacePublicCatalog/,
  );
  assert.match(
    read("apps/web/app/api/marketplace/products/route.ts"),
    /allowMarketplacePublicCatalog/,
  );
  assert.doesNotMatch(
    read("apps/web/app/api/marketplace/sellers/route.ts"),
    /requireMarketplaceClientAuth/,
  );
});

test("mobile navigator allows guest marketplace browse", () => {
  const src = read("apps/mobile/src/navigation/AppNavigator.tsx");
  assert.match(src, /isGuestMarketplaceBrowse/);
  assert.match(src, /MarketplaceProductDetails/);
});

test("RoleSelect exposes Browse Marketplace entry", () => {
  const src = read("apps/mobile/src/screens/RoleSelectScreen.tsx");
  assert.match(src, /browseMarketplace/);
  assert.match(src, /MarketplaceHome/);
});

test("seller area includes in-app account deletion for App Review 5.1.1(v)", () => {
  const dashboard = read("apps/mobile/src/screens/seller/SellerDashboardScreen.tsx");
  const onboarding = read("apps/mobile/src/screens/seller/SellerOnboardingScreen.tsx");
  const nav = read("apps/mobile/src/navigation/AppNavigator.tsx");
  const deletion = read("apps/web/src/lib/accountDeletion.ts");
  assert.match(dashboard, /openDeleteAccountScreen/);
  assert.match(onboarding, /openDeleteAccountScreen/);
  assert.match(nav, /isInSellerArea[\s\S]*DeleteAccount/);
  assert.match(deletion, /"seller"/);
  assert.match(deletion, /business_name: `Deleted Seller/);
  assert.match(deletion, /taxi_business_members/);
});

test("Play/Apple store config pins API 36, Xcode 26 image, and web account deletion", () => {
  const appConfig = read("app.config.ts");
  const appJson = read("apps/mobile/app.json");
  const eas = JSON.parse(read("eas.json"));
  const deletionPage = read("apps/web/app/legal/account-deletion/page.tsx");
  const deletionCopy = read("apps/web/src/components/site/accountDeletionContent.ts");
  const legalUrls = read("apps/mobile/src/lib/legalUrls.ts");

  assert.match(appConfig, /targetSdkVersion:\s*36/);
  assert.match(appConfig, /compileSdkVersion:\s*36/);
  assert.match(appConfig, /SYSTEM_ALERT_WINDOW/);
  assert.match(appJson, /"targetSdkVersion":\s*36/);
  assert.match(appJson, /SYSTEM_ALERT_WINDOW/);
  assert.doesNotMatch(appConfig, /READ_CONTACTS|READ_PHONE_STATE|CALL_PHONE/);
  assert.doesNotMatch(appJson, /READ_CONTACTS|READ_PHONE_STATE|CALL_PHONE/);
  assert.equal(eas?.build?.production?.ios?.image, "sdk-54");
  assert.match(deletionPage, /ACCOUNT_DELETION_URL/);
  assert.match(deletionCopy, /www\.mmddelivery\.com\/legal\/account-deletion/);
  assert.match(legalUrls, /\/legal\/account-deletion/);
});

test("iOS associated domains use www only (apex AASA 307s and is invalid)", () => {
  const appConfig = read("app.config.ts");
  const appJson = read("apps/mobile/app.json");
  assert.match(appConfig, /applinks:www\.mmddelivery\.com/);
  assert.match(appJson, /applinks:www\.mmddelivery\.com/);
  assert.doesNotMatch(appConfig, /applinks:mmddelivery\.com"/);
  assert.doesNotMatch(appJson, /applinks:mmddelivery\.com"/);
});

test("RestaurantSetup submit CTA honors iPad home-indicator insets", () => {
  const src = read(
    "apps/mobile/src/screens/restaurant/RestaurantSetupScreen.tsx",
  );
  assert.match(src, /useSafeAreaInsets/);
  assert.match(src, /insets\.bottom/);
  assert.match(src, /ctaBottom/);
});

test("StripeGate does not load Stripe native views on Login", () => {
  const src = read("apps/mobile/src/lib/StripeGate.tsx");
  assert.doesNotMatch(src, /from ["']@stripe\/stripe-react-native["']/);
  assert.match(src, /import\(["']@stripe\/stripe-react-native["']\)/);
  assert.match(src, /if \(!hasSession\)/);
  assert.match(src, /LazyStripeTree/);
});

test("Client Home fetch fail-open cannot leave branded loader forever", () => {
  const boot = read("apps/mobile/src/lib/bootFailOpen.ts");
  assert.match(boot, /CLIENT_HOME_FETCH_TIMEOUT_MS\s*=\s*8_000/);

  const home = read("apps/mobile/src/screens/ClientHomeScreen.tsx");
  assert.match(home, /CLIENT_HOME_FETCH_TIMEOUT_MS/);
  assert.match(home, /withTimeout\(/);
  assert.match(home, /client_home_fetch/);
  assert.match(home, /fetchClientAdvertisements\(/);
  assert.match(home, /\.catch\(\(\) => \[\]\)/);
  assert.match(home, /setLoading\(false\)/);
});

test("DriverAuth does not statically import native image picker", () => {
  const src = read("apps/mobile/src/screens/DriverAuthScreen.tsx");
  assert.doesNotMatch(src, /from ["']expo-image-picker["']/);
  assert.doesNotMatch(src, /from ["']expo-file-system/);
  assert.match(src, /import\(["']expo-image-picker["']\)/);
});

test("RoleSelect exposes explicit Log in entry for App Review", () => {
  const src = read("apps/mobile/src/screens/RoleSelectScreen.tsx");
  assert.match(src, /role-select-login-button/);
  assert.match(src, /client\.auth\.loginBtn/);
  assert.match(src, /justifyContent:\s*"flex-start"/);
});

console.log("appleReviewFixes tests passed");
