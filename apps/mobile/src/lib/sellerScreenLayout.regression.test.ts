import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const layout = read("lib/sellerScreenLayout.ts");
assert(layout.includes("SELLER_CONTENT_MAX_WIDTH = 720"), "tablet max width 720");
assert(layout.includes("windowWidth >= 768"), "tablet breakpoint");

const chrome = read("components/seller/SellerChrome.tsx");
assert(chrome.includes("SellerContentWrap"), "content wrap exported");
assert(chrome.includes("useSellerContentLayout"), "layout hook exported");
assert(chrome.includes("resolveSellerContentMaxWidth"), "uses layout helper");

const screens = [
  "screens/seller/SellerDashboardScreen.tsx",
  "screens/seller/SellerOrdersScreen.tsx",
  "screens/seller/SellerProductsScreen.tsx",
  "screens/seller/SellerWalletScreen.tsx",
  "screens/seller/SellerOnboardingScreen.tsx",
];
for (const screen of screens) {
  const src = read(screen);
  assert(
    src.includes("SellerContentWrap") || src.includes("useSellerContentLayout"),
    `${screen} uses seller responsive layout`
  );
}

console.log("sellerScreenLayout.regression.test.ts — PASS");
