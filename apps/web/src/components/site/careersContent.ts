import type { SiteBlockRow } from "@/lib/siteCms";

export const CAREERS_SEO = {
  title: "Careers — MMD Delivery",
  description: "Join MMD Delivery. Explore roles across product, operations, support, and growth for a multi-service logistics platform.",
  robots: "index,follow",
} as const;

export const CAREERS_START_STEPS = [
  {
    "title": "Review open themes",
    "body": "Tell us which domain fits you — product, ops, support, partnerships, or growth."
  },
  {
    "title": "Send your profile",
    "body": "Contact our talent team with your CV and the problems you want to own."
  },
  {
    "title": "Conversation",
    "body": "We discuss experience, craft, and how you operate under production constraints."
  },
  {
    "title": "Join the build",
    "body": "Onboard with clear goals and ship alongside the core platform team."
  }
] as const;

export function buildCareersFallbackBlocks(): SiteBlockRow[] {
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
      id: "careers-hero",
      ...base,
      block_type: "hero",
      sort_order: 10,
      payload: {
        eyebrow: "Careers",
        headline: "Build the future of local delivery",
        headline_style: "solid",
        subheadline: "Help us ship reliable taxi, food, package, marketplace, and business logistics used in production every day.",
        showcase: "image",
        image_url: "/brand/services/package.webp",
        benefits: ["Product & engineering","Operations & support","Growth roles"],
        primary_ctas: [{"label":"Contact talent team","href":"/contact","event":"cta_careers_contact"}],
        secondary_ctas: [{"label":"About the company","href":"/company","event":"cta_company"}],
      },
    },
    {
      id: "careers-features",
      ...base,
      block_type: "features",
      sort_order: 20,
      payload: {
        title: "Why work at MMD",
        items: [{"title":"Real production systems","description":"Ship features that move people, food, and packages — with payments and dispatch that must work."},{"title":"Multi-sided platform","description":"Collaborate across customer, driver, restaurant, seller, and business experiences."},{"title":"Ownership culture","description":"Small teams, clear accountability, and high bars for reliability."},{"title":"Customer empathy","description":"We design for the stressful moments — late nights, peak hours, and live support."}],
      },
    },
    {
      id: "careers-steps",
      ...base,
      block_type: "how_it_works",
      sort_order: 30,
      payload: {
        title: "How to apply",
        anchor: "apply",
        steps: CAREERS_START_STEPS.map((step) => ({ ...step })),
      },
    },
    {
      id: "careers-rich",
      ...base,
      block_type: "rich_text",
      sort_order: 40,
      payload: {
        title: "Open conversations",
        body_md: "We hire for impact across engineering, design, operations, and partner success. Even if a role is not listed, send a strong note.\n\n[Contact talent](/contact)",
      },
    },
    {
      id: "careers-cta",
      ...base,
      block_type: "cta",
      sort_order: 50,
      payload: {
        title: "Ready to apply?",
        body: "Reach out and tell us how you want to strengthen MMD Delivery.",
        buttons: [{"label":"Contact talent team","href":"/contact","event":"cta_careers_contact"},{"label":"Company overview","href":"/company","event":"cta_company"}],
      },
    },
    {
      id: "careers-faq",
      ...base,
      block_type: "faq",
      sort_order: 60,
      payload: {
        title: "Careers FAQ",
        source: "site_faq",
      },
    }
  ];
}
