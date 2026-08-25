import type { SiteBlockRow } from "@/lib/siteCms";
import { TERMS_SECTIONS, TERMS_SEO } from "./legalPageCopy";

export { TERMS_SEO };

export function buildTermsFallbackBlocks(): SiteBlockRow[] {
  const now = new Date().toISOString();
  const base = {
    page_id: "fallback",
    visible: true as const,
    status: "published" as const,
    published_at: now,
    scheduled_for: null,
  };

  const sections: SiteBlockRow[] = TERMS_SECTIONS.map((section, index) => ({
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
      id: "terms-hero",
      ...base,
      block_type: "hero",
      sort_order: 10,
      payload: {
        eyebrow: "Legal",
        headline: "Terms of Service",
        headline_style: "solid",
        subheadline:
          "Rules for using MMD Delivery, including the SMS messaging program, HELP and STOP instructions, and payments.",
        showcase: "image",
        image_url: "/brand/og-transparent-v2.png",
        benefits: ["SMS HELP and STOP", "Message and data rates may apply", "Public, no login"],
        primary_ctas: [{ label: "Contact support", href: "/contact", event: "cta_contact" }],
        secondary_ctas: [{ label: "Privacy Policy", href: "/legal/privacy", event: "cta_privacy" }],
      },
    },
    ...sections,
    {
      id: "terms-cta",
      ...base,
      block_type: "cta",
      sort_order: 20 + TERMS_SECTIONS.length * 10 + 10,
      payload: {
        title: "Need clarification?",
        body: "Our support team can explain how these terms apply to your account or SMS messages.",
        buttons: [
          { label: "Contact support", href: "/contact", event: "cta_contact" },
          { label: "FAQ", href: "/faq", event: "cta_faq" },
        ],
      },
    },
  ];
}
