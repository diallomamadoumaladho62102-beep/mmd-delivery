import type { SiteBlockRow } from "@/lib/siteCms";
import { COOKIES_SECTIONS, COOKIES_SEO } from "./legalPageCopy";

export { COOKIES_SEO };

export function buildCookiesFallbackBlocks(): SiteBlockRow[] {
  const now = new Date().toISOString();
  const base = {
    page_id: "fallback",
    visible: true as const,
    status: "published" as const,
    published_at: now,
    scheduled_for: null,
  };

  const sections: SiteBlockRow[] = COOKIES_SECTIONS.map((section, index) => ({
    id: section.id,
    ...base,
    block_type: "rich_text",
    sort_order: 20 + index * 10,
    payload: {
      title: section.title,
      body_md: section.body_md,
    },
  }));

  return [
    {
      id: "cookies-hero",
      ...base,
      block_type: "hero",
      sort_order: 10,
      payload: {
        eyebrow: "Legal",
        headline: "Cookies",
        headline_style: "solid",
        subheadline:
          "Necessary cookies and similar storage used to operate the MMD Delivery website.",
        showcase: "image",
        image_url: "/brand/og-transparent-v2.png",
        benefits: ["No advertising cookies", "Locale preference", "Privacy-linked"],
        primary_ctas: [{ label: "Privacy Policy", href: "/legal/privacy", event: "cta_privacy" }],
        secondary_ctas: [
          { label: "Terms of Service", href: "/legal/terms", event: "cta_terms" },
          { label: "Contact", href: "/contact", event: "cta_contact" },
        ],
      },
    },
    ...sections,
  ];
}
