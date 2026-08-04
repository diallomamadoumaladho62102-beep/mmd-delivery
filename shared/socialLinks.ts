/**
 * SINGLE SOURCE OF TRUTH for official MMD Delivery social / web presence.
 *
 * Rules:
 * - Persist every official URL here only — never hardcode elsewhere.
 * - Use getActiveSocialLinks() for UI that should hide placeholders.
 * - TikTok default link is always the canonical profile URL.
 * - TikTok share URL is for QR / marketing materials only.
 */

export type SocialNetworkId =
  | "website"
  | "tiktok"
  | "instagram"
  | "facebook"
  | "x"
  | "linkedin"
  | "youtube";

export type SocialLinkDefinition = {
  id: SocialNetworkId;
  label: string;
  /** Profile handle when applicable (e.g. @mmddelivery). */
  username?: string;
  /** Primary outbound URL used in footers, headers, and CTAs. */
  url: string;
  /**
   * Optional alternate URL for QR codes / campaign materials.
   * Never used as the default click target in product UI.
   */
  shareUrl?: string;
  /** Public asset path for the matching QR code (web). */
  qrPath: string;
  /** When false, the network is reserved for a future activation. */
  enabled: boolean;
};

export const OFFICIAL_WEBSITE_URL = "https://www.mmddelivery.com";

export const OFFICIAL_SOCIAL_LINKS: readonly SocialLinkDefinition[] = [
  {
    id: "website",
    label: "Website",
    url: OFFICIAL_WEBSITE_URL,
    qrPath: "/brand/qr/website.png",
    enabled: true,
  },
  {
    id: "tiktok",
    label: "TikTok",
    username: "@mmddelivery",
    url: "https://www.tiktok.com/@mmddelivery",
    shareUrl: "https://www.tiktok.com/@mmddelivery?_r=1&_t=ZP-98awmQSESJ5",
    qrPath: "/brand/qr/tiktok.png",
    enabled: true,
  },
  {
    id: "instagram",
    label: "Instagram",
    username: "@mmddelivery",
    url: "https://www.instagram.com/mmddelivery?igsh=d3o1YXR3M3g1Z3dq&utm_source=ig_contact_invite",
    qrPath: "/brand/qr/instagram.png",
    enabled: true,
  },
  {
    id: "facebook",
    label: "Facebook",
    url: "https://www.facebook.com/share/1FF11rBXwE/?mibextid=wwXIfr",
    qrPath: "/brand/qr/facebook.png",
    enabled: true,
  },
  {
    id: "x",
    label: "X",
    username: "@mmddelivery",
    url: "",
    qrPath: "/brand/qr/x.png",
    enabled: false,
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    url: "",
    qrPath: "/brand/qr/linkedin.png",
    enabled: false,
  },
  {
    id: "youtube",
    label: "YouTube",
    url: "",
    qrPath: "/brand/qr/youtube.png",
    enabled: false,
  },
] as const;

/** QR targets for marketing / print kits (includes TikTok share alternate). */
export type SocialQrTarget = {
  id: string;
  label: string;
  url: string;
  /** File stem under /brand/qr/ (without extension). */
  fileStem: string;
  /** Suggested print / kit usages. */
  kits: readonly string[];
};

export const SOCIAL_QR_TARGETS: readonly SocialQrTarget[] = [
  {
    id: "website",
    label: "Website",
    url: OFFICIAL_WEBSITE_URL,
    fileStem: "website",
    kits: [
      "business-cards",
      "referral-cards",
      "loyalty-cards",
      "flyers",
      "posters",
      "restaurant-materials",
      "driver-welcome-kit",
      "merchant-kit",
      "vehicle-stickers",
      "roll-up-banners",
      "presentation-slides",
      "brochures",
      "email-signatures",
      "packaging-inserts",
    ],
  },
  {
    id: "tiktok",
    label: "TikTok (Canonical)",
    url: "https://www.tiktok.com/@mmddelivery",
    fileStem: "tiktok",
    kits: [
      "business-cards",
      "flyers",
      "posters",
      "driver-welcome-kit",
      "merchant-kit",
      "roll-up-banners",
      "brochures",
      "email-signatures",
    ],
  },
  {
    id: "tiktok-share",
    label: "TikTok (Share)",
    url: "https://www.tiktok.com/@mmddelivery?_r=1&_t=ZP-98awmQSESJ5",
    fileStem: "tiktok-share",
    kits: ["referral-cards", "loyalty-cards", "packaging-inserts", "flyers"],
  },
  {
    id: "instagram",
    label: "Instagram",
    url: "https://www.instagram.com/mmddelivery?igsh=d3o1YXR3M3g1Z3dq&utm_source=ig_contact_invite",
    fileStem: "instagram",
    kits: [
      "business-cards",
      "flyers",
      "posters",
      "restaurant-materials",
      "merchant-kit",
      "roll-up-banners",
      "brochures",
      "email-signatures",
    ],
  },
  {
    id: "facebook",
    label: "Facebook",
    url: "https://www.facebook.com/share/1FF11rBXwE/?mibextid=wwXIfr",
    fileStem: "facebook",
    kits: [
      "business-cards",
      "flyers",
      "posters",
      "restaurant-materials",
      "merchant-kit",
      "brochures",
      "email-signatures",
    ],
  },
] as const;

export function getSocialLink(
  id: SocialNetworkId,
): SocialLinkDefinition | undefined {
  return OFFICIAL_SOCIAL_LINKS.find((link) => link.id === id);
}

/** Active networks only (enabled + non-empty URL). */
export function getActiveSocialLinks(): SocialLinkDefinition[] {
  return OFFICIAL_SOCIAL_LINKS.filter(
    (link) => link.enabled && String(link.url ?? "").trim().length > 0,
  );
}

/** Record keyed by network id → primary URL (active only). */
export function getActiveSocialUrlMap(): Record<string, string> {
  return Object.fromEntries(
    getActiveSocialLinks().map((link) => [link.id, link.url]),
  );
}

/** Plain-text block for emails / signatures. */
export function formatSocialLinksPlainText(
  links: SocialLinkDefinition[] = getActiveSocialLinks(),
): string {
  return links
    .map((link) => {
      const handle = link.username ? ` (${link.username})` : "";
      return `${link.label}${handle}: ${link.url}`;
    })
    .join("\n");
}
