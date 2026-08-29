/** Shared copy for the public-site app banner (testable without React). */
export const MOBILE_APP_COMING_SOON_BANNER = {
  title: "Get the MMD Delivery app",
  body:
    "Taxi, food, package delivery, and marketplace browse are available in the MMD Delivery mobile app. Official App Store and Google Play listing links will appear here when Apple and Google publish them. This website does not invent store URLs.",
  storeBadges: [
    { platform: "App Store", suffix: "Listing pending", icon: "" },
    { platform: "Google Play", suffix: "Listing pending", icon: "▶" },
  ],
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
    throw new Error("banner must not say Coming Soon while the app is submitted");
  }
  for (const badge of banner.storeBadges) {
    if (badge.suffix.toLowerCase().includes("coming soon")) {
      throw new Error(`badge ${badge.platform} must not say Coming Soon`);
    }
    if (badge.platform === "App Store" && !badge.icon) {
      throw new Error("App Store badge needs icon");
    }
  }
  const forbidden = [
    "apps.apple.com",
    "play.google.com",
    "itms-apps://",
    "market://",
  ];
  const combined = `${banner.title} ${banner.body}`;
  for (const token of forbidden) {
    if (combined.includes(token)) {
      throw new Error(`banner must not include fake store URL: ${token}`);
    }
  }
}
