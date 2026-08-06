import type { SiteBlockRow } from "@/lib/siteCms";

export const PARTNERS_SEO = {
  title: "Partners — MMD Delivery",
  description: "Partner with MMD Delivery as a restaurant, driver network, seller, or business logistics collaborator.",
  robots: "index,follow",
} as const;

export const PARTNERS_START_STEPS = [
  {
    "title": "Tell us your model",
    "body": "Share whether you are a restaurant, fleet, seller, or strategic collaborator."
  },
  {
    "title": "Align on operations",
    "body": "We map onboarding, SLAs, and the tools your team will use daily."
  },
  {
    "title": "Go live",
    "body": "Launch with production payments, dispatch, and support coverage."
  },
  {
    "title": "Optimize together",
    "body": "Review performance and expand services as volume grows."
  }
] as const;

export function buildPartnersFallbackBlocks(): SiteBlockRow[] {
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
      id: "partners-hero",
      ...base,
      block_type: "hero",
      sort_order: 10,
      payload: {
        eyebrow: "Partners",
        headline: "Grow with MMD Delivery",
        headline_style: "solid",
        subheadline: "Collaborate as a restaurant, driver fleet, marketplace seller, or strategic partner on a production multi-service platform.",
        showcase: "image",
        image_url: "/brand/services/food.webp",
        benefits: ["Restaurant partners","Driver networks","Marketplace sellers"],
        primary_ctas: [{"label":"Become a partner","href":"/contact","event":"cta_partners"}],
        secondary_ctas: [{"label":"Restaurant signup","href":"/signup/restaurant","event":"cta_restaurant"}],
      },
    },
    {
      id: "partners-features",
      ...base,
      block_type: "features",
      sort_order: 20,
      payload: {
        title: "Partnership tracks",
        items: [{"title":"Restaurants","description":"Publish menus, accept delivery orders, and cash out through Stripe Connect when eligible."},{"title":"Drivers","description":"Multi-service missions with live GPS and transparent wallet tooling."},{"title":"Marketplace sellers","description":"List products with secure checkout and delivery built into MMD."},{"title":"Strategic partners","description":"Integrate logistics capacity, promotions, or local distribution programs."}],
      },
    },
    {
      id: "partners-steps",
      ...base,
      block_type: "how_it_works",
      sort_order: 30,
      payload: {
        title: "How partnering works",
        anchor: "partner-path",
        steps: PARTNERS_START_STEPS.map((step) => ({ ...step })),
      },
    },
    {
      id: "partners-rich",
      ...base,
      block_type: "rich_text",
      sort_order: 40,
      payload: {
        title: "Partner with confidence",
        body_md: "MMD partners operate on the same infrastructure customers already trust for taxi, food, packages, and marketplace delivery.\n\n[Start the conversation](/contact)",
      },
    },
    {
      id: "partners-cta",
      ...base,
      block_type: "cta",
      sort_order: 50,
      payload: {
        title: "Let's partner",
        body: "Contact our partnerships team to explore the right track for your business.",
        buttons: [{"label":"Contact partnerships","href":"/contact","event":"cta_partners"},{"label":"Driver signup","href":"/signup/driver","event":"cta_driver"}],
      },
    },
    {
      id: "partners-faq",
      ...base,
      block_type: "faq",
      sort_order: 60,
      payload: {
        title: "Partners FAQ",
        source: "site_faq",
      },
    }
  ];
}
