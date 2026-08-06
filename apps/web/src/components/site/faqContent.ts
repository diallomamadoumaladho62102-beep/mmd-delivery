import type { SiteBlockRow } from "@/lib/siteCms";

export const FAQ_SEO = {
  title: "FAQ — MMD Delivery",
  description: "Answers about MMD Delivery orders, payments, drivers, restaurants, business accounts, and support.",
  robots: "index,follow",
} as const;

export function buildFaqFallbackBlocks(): SiteBlockRow[] {
  const now = new Date().toISOString();
  const base = {
    page_id: "fallback",
    visible: true as const,
    status: "published" as const,
    published_at: now,
    scheduled_for: null,
  };

  return [
    {
      id: "faq-hero",
      ...base,
      block_type: "hero",
      sort_order: 10,
      payload: {
        eyebrow: "Help Center",
        headline: "Frequently asked questions",
        headline_style: "solid",
        subheadline: "Clear answers about payments, delivery, drivers, restaurants, and business accounts — built for production operations.",
        showcase: "image",
        image_url: "/brand/services/taxi.webp",
        benefits: ["Pay-then-create clarity","Multi-service coverage","Human support"],
        primary_ctas: [{"label":"Contact support","href":"/contact","event":"cta_contact"}],
        secondary_ctas: [{"label":"How it works","href":"/how-it-works","event":"cta_how_it_works"}],
      },
    },
    {
      id: "faq-faq",
      ...base,
      block_type: "faq",
      sort_order: 20,
      payload: {
        title: "FAQ",
        source: "site_faq",
      },
    },
    {
      id: "faq-cta",
      ...base,
      block_type: "cta",
      sort_order: 30,
      payload: {
        title: "Still need help?",
        body: "Reach our support team and we will help you resolve account, order, or payout questions.",
        buttons: [{"label":"Contact support","href":"/contact","event":"cta_contact"},{"label":"Download the app","href":"/download","event":"cta_download"}],
      },
    }
  ];
}
