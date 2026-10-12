/**
 * Official store links for the public site.
 * iOS was verified against the public iTunes lookup for track id 6761693075
 * (name MMD Delivery, bundle com.maladho2025.mmddelivery, seller Mamadou Maladho Diallo).
 * Google Play for that package returned HTTP 404, so no Play URL is published.
 */
export const OFFICIAL_APP_STORE_ID = "6761693075";
export const OFFICIAL_APP_STORE_URL =
  "https://apps.apple.com/us/app/mmd-delivery/id6761693075";
export const OFFICIAL_ANDROID_PACKAGE = "com.maladho2025.mmddelivery";

export const MOBILE_APP_COMING_SOON_BANNER = {
  title: "Get the MMD Delivery app",
  body:
    "MMD Delivery is available on the App Store. You can also order food and package delivery on this website after signing in. Google Play has no verified public listing yet.",
  ios: {
    platform: "App Store",
    label: "Download on the App Store",
    href: OFFICIAL_APP_STORE_URL,
  },
  android: {
    platform: "Google Play",
    label: "Google Play",
    href: null as string | null,
    note: "No verified public listing",
  },
} as const;

export function assertMobileAppComingSoonBannerContent(
  banner: typeof MOBILE_APP_COMING_SOON_BANNER,
): void {
  if (!banner.title.toLowerCase().includes("app")) {
    throw new Error("banner title must mention the app");
  }
  if (!banner.body.includes("App Store")) {
    throw new Error("banner body must mention App Store");
  }
  if (!banner.body.includes("Google Play")) {
    throw new Error("banner body must mention Google Play");
  }
  if (banner.body.toLowerCase().includes("coming soon")) {
    throw new Error("banner must not say Coming Soon");
  }
  if (banner.body.toLowerCase().includes("listing pending")) {
    throw new Error("banner must not say the App Store listing is pending");
  }
  if (!banner.ios.href.includes(`/id${OFFICIAL_APP_STORE_ID}`)) {
    throw new Error("App Store link must use the verified track id");
  }
  if (!banner.ios.href.startsWith("https://apps.apple.com/")) {
    throw new Error("App Store link must be an https apps.apple.com URL");
  }
  if (banner.android.href != null) {
    throw new Error("Google Play link must stay empty until a public listing is verified");
  }
  if (banner.body.includes("play.google.com") || banner.ios.href.includes("play.google.com")) {
    throw new Error("do not publish an unverified Google Play URL");
  }
}
