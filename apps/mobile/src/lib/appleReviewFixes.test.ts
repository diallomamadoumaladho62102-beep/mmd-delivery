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
  }
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

console.log("appleReviewFixes tests passed");
