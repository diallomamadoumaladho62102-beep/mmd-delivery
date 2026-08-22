import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

function read(rel: string): string {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const chrome = read("components/seller/SellerChrome.tsx");
assert(chrome.includes("CommonActions.reset"), "seller bottom nav resets stack");
assert(chrome.includes("SellerContentWrap"), "seller content wrap in chrome");

const layout = read("lib/sellerScreenLayout.ts");
assert(layout.includes("SELLER_CONTENT_MAX_WIDTH"), "seller layout module exists");
assert(chrome.includes("SellerDashboard"), "seller nav routes wired");

const onboarding = read("screens/seller/SellerOnboardingScreen.tsx");
assert(onboarding.includes("sellerSignOutLabels"), "seller profile has logout");
assert(onboarding.includes("confirmSignOutToRoleSelect"), "seller logout uses shared sign-out");
assert(onboarding.includes('navigation.navigate("SellerDashboard")'), "profile save navigates to dashboard");

const dashboard = read("screens/seller/SellerDashboardScreen.tsx");
assert(dashboard.includes("sellerSignOutLabels"), "dashboard has logout");

const authRole = read("lib/authRole.ts");
assert(authRole.includes("resolvePostAuthRoute"), "post-auth route helper exists");
assert(authRole.includes("SellerGate"), "seller post-auth route defined");

const clientAuth = read("screens/ClientAuthScreen.tsx");
assert(clientAuth.includes("resolvePostAuthRoute"), "client auth uses role-aware routing");

const orders = read("screens/seller/SellerOrdersScreen.tsx");
assert(orders.includes("highlightOrderId"), "seller orders reads push highlight param");

const wallet = read("screens/seller/SellerWalletScreen.tsx");
assert(wallet.includes("loadOwnSeller"), "wallet loads seller for country");
assert(!wallet.includes('countryCode: "US"'), "wallet no longer hardcodes US only");

const products = read("screens/seller/SellerProductsScreen.tsx");
assert(products.includes("deleteSellerProduct"), "product delete wired");
assert(products.includes("priceCents <= 0"), "zero price rejected");
assert(products.includes("useSafeAreaInsets"), "product modal respects safe area");

const signOut = read("lib/signOutToRoleSelect.ts");
assert(signOut.includes("sellerSignOutLabels"), "seller sign-out labels exported");

const nav = read("navigation/AppNavigator.tsx");
assert(nav.includes("highlightOrderId"), "SellerOrders route accepts highlight param");

console.log("marketplaceSellerMobile.regression.test.ts — PASS");
