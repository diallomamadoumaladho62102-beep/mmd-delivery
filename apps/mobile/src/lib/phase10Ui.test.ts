import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const mobileRoot = process.cwd();
const repoRoot = join(mobileRoot, "..", "..");
const webRoot = join(repoRoot, "apps/web");

function readMobile(rel: string) {
  return readFileSync(join(mobileRoot, rel), "utf8");
}

function readWeb(rel: string) {
  return readFileSync(join(webRoot, rel), "utf8");
}

// Design system tokens
{
  assert.ok(existsSync(join(mobileRoot, "src/theme/appTheme.ts")));
  assert.match(readMobile("src/theme/appTheme.ts"), /APP_COLORS/);
  assert.match(readMobile("src/theme/appTheme.ts"), /accentStrong/);
}

// Shared UI primitives
{
  assert.ok(existsSync(join(mobileRoot, "src/components/ui/UiButton.tsx")));
  assert.ok(existsSync(join(mobileRoot, "src/components/ui/UiStates.tsx")));
  assert.ok(existsSync(join(mobileRoot, "src/components/ui/UiCard.tsx")));
  assert.match(readMobile("src/components/ui/UiButton.tsx"), /accessibilityRole="button"/);
  assert.match(readMobile("src/components/ui/UiStates.tsx"), /UiSkeleton/);
}

// ScreenShell + header a11y
{
  assert.match(readMobile("src/components/navigation/ScreenShell.tsx"), /APP_COLORS\.bg/);
  const header = readMobile("src/components/navigation/ScreenHeader.tsx");
  assert.match(header, /useTranslation/);
  assert.match(header, /accessibilityLabel/);
  assert.doesNotMatch(header, /accessibilityLabel="Retour"/);
}

// Seller/marketplace use tokens (spot-check)
{
  assert.match(readMobile("src/screens/seller/SellerDashboardScreen.tsx"), /APP_COLORS/);
  assert.match(readMobile("src/screens/marketplace/MarketplaceHomeScreen.tsx"), /APP_COLORS/);
  assert.match(readMobile("src/navigation/DriverTabs.tsx"), /APP_COLORS\.accent/);
}

// Web Button no longer stub + AdminShell + tokens
{
  const button = readWeb("src/components/Button.tsx");
  assert.doesNotMatch(button, /Button component<\/div>/);
  assert.match(button, /focus-visible/);
  assert.ok(existsSync(join(webRoot, "src/components/AdminShell.tsx")));
  assert.match(readWeb("tailwind.config.ts"), /\.\/app\/\*\*/);
  assert.match(readWeb("app/globals.css"), /--mmd-accent/);
  assert.match(readWeb("app/admin/layout.tsx"), /AdminShell/);
}

console.log("phase10Ui tests passed");
