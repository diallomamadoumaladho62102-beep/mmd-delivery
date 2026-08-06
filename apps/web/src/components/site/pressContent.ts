import type { SiteBlockRow } from "@/lib/siteCms";

export const PRESS_SEO = {
  title: "Press — MMD Delivery",
  description: "Press and media resources for MMD Delivery — brand assets, company facts, and media contact.",
  robots: "index,follow",
} as const;

export function buildPressFallbackBlocks(): SiteBlockRow[] {
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
      id: "press-hero",
      ...base,
      block_type: "hero",
      sort_order: 10,
      payload: {
        eyebrow: "Press",
        headline: "Media & brand resources",
        headline_style: "solid",
        subheadline: "Get the facts, brand assets, and the right contact for stories about MMD Delivery.",
        showcase: "image",
        image_url: "/brand/og-transparent-v2.png",
        benefits: ["Brand assets","Company facts","Media contact"],
        primary_ctas: [{"label":"Contact press","href":"/contact","event":"cta_press"}],
        secondary_ctas: [{"label":"Company overview","href":"/company","event":"cta_company"}],
      },
    },
    {
      id: "press-features",
      ...base,
      block_type: "features",
      sort_order: 20,
      payload: {
        title: "For journalists",
        items: [{"title":"Accurate positioning","description":"MMD Delivery is a multi-service logistics platform spanning taxi, food, packages, marketplace, and business."},{"title":"Production focus","description":"Our product emphasizes pay-then-create integrity, live GPS, and operational reliability."},{"title":"Brand kit","description":"Use official logos and brand imagery from our public brand assets."},{"title":"Direct contact","description":"Reach the team through the contact form for interviews and fact checks."}],
      },
    },
    {
      id: "press-rich",
      ...base,
      block_type: "rich_text",
      sort_order: 30,
      payload: {
        title: "Press contact",
        body_md: "For media inquiries, email support@mmddelivery.com with subject line Press and your deadline.\n\n[Contact form](/contact)",
      },
    },
    {
      id: "press-cta",
      ...base,
      block_type: "cta",
      sort_order: 40,
      payload: {
        title: "Need a quote or asset?",
        body: "Send your request and timeline — we will respond as quickly as possible.",
        buttons: [{"label":"Contact press","href":"/contact","event":"cta_press"},{"label":"Download brand logo","href":"/brand/mmd-logo-transparent-v2.png","event":"cta_brand"}],
      },
    },
    {
      id: "press-faq",
      ...base,
      block_type: "faq",
      sort_order: 50,
      payload: {
        title: "Press FAQ",
        source: "site_faq",
      },
    }
  ];
}
