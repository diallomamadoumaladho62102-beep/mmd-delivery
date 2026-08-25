import type { SiteBlockRow } from "@/lib/siteCms";
import { PRIVACY_SECTIONS, PRIVACY_SEO } from "./legalPageCopy";

export { PRIVACY_SEO };

export function buildPrivacyFallbackBlocks(): SiteBlockRow[] {
  const now = new Date().toISOString();
  const base = {
    page_id: "fallback",
    visible: true as const,
    status: "published" as const,
    published_at: now,
    scheduled_for: null,
  };

  const sections: SiteBlockRow[] = PRIVACY_SECTIONS.map((section, index) => ({
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
      id: "privacy-hero",
      ...base,
      block_type: "hero",
      sort_order: 10,
      payload: {
        eyebrow: "Legal",
        headline: "Privacy Policy",
        headline_style: "solid",
        subheadline:
          "How MMD Delivery collects, uses, and protects account, order, location, payment, and SMS information.",
        showcase: "image",
        image_url: "/brand/og-transparent-v2.png",
        benefits: ["No login required", "SMS and phone notices", "Access and deletion requests"],
        primary_ctas: [{ label: "Contact privacy", href: "/contact", event: "cta_privacy" }],
        secondary_ctas: [{ label: "Terms of Service", href: "/legal/terms", event: "cta_terms" }],
      },
    },
    ...sections,
    {
      id: "privacy-cta",
      ...base,
      block_type: "cta",
      sort_order: 20 + PRIVACY_SECTIONS.length * 10 + 10,
      payload: {
        title: "Questions about privacy?",
        body: "Contact support for access, deletion, or SMS opt-out help.",
        buttons: [
          { label: "Contact support", href: "/contact", event: "cta_contact" },
          { label: "Support page", href: "/legal/support", event: "cta_support" },
        ],
      },
    },
  ];
}
