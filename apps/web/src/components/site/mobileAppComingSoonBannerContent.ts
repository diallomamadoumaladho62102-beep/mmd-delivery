/** Shared copy for mobile app coming-soon banner (testable without React). */
export const MOBILE_APP_COMING_SOON_BANNER = {
  title: "MMD Delivery arrive bientôt sur mobile !",
  body:
    "Retrouvez bientôt MMD Delivery sur Apple App Store et Google Play Store. Téléchargez l'application dès sa disponibilité et profitez de toute l'expérience MMD Delivery.",
  storeBadges: [
    { platform: "App Store", suffix: "Coming Soon", icon: "" },
    { platform: "Google Play", suffix: "Coming Soon", icon: "▶" },
  ],
} as const;

export function assertMobileAppComingSoonBannerContent(
  banner: typeof MOBILE_APP_COMING_SOON_BANNER,
): void {
  if (!banner.title.includes("bientôt")) {
    throw new Error("banner title must mention bientôt");
  }
  if (!banner.body.includes("Apple App Store")) {
    throw new Error("banner body must mention Apple App Store");
  }
  if (!banner.body.includes("Google Play Store")) {
    throw new Error("banner body must mention Google Play Store");
  }
  for (const badge of banner.storeBadges) {
    if (badge.suffix !== "Coming Soon") {
      throw new Error(`badge ${badge.platform} must say Coming Soon`);
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
