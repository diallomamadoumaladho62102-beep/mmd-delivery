import type { SiteBlockRow } from "@/lib/siteCms";

export const COMPANY_SEO = {
  title: "Company — MMD Delivery",
  description: "Learn about MMD Delivery — modern multi-service infrastructure for taxi, food, packages, marketplace, and business logistics.",
  robots: "index,follow",
} as const;

export const COMPANY_START_STEPS = [
  {
    "title": "Discover the platform",
    "body": "Explore taxi, food, packages, marketplace, and business services in one product family."
  },
  {
    "title": "Choose your role",
    "body": "Join as a customer, driver, restaurant, seller, or business team."
  },
  {
    "title": "Operate with clarity",
    "body": "Track jobs, payouts, and approvals with production-grade status flows."
  },
  {
    "title": "Grow with support",
    "body": "Use Help Center, FAQ, and human support when you need a hand."
  }
] as const;

export function buildCompanyFallbackBlocks(): SiteBlockRow[] {
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
      id: "company-hero",
      ...base,
      block_type: "hero",
      sort_order: 10,
      payload: {
        eyebrow: "Company",
        headline: "We Deliver With Heart",
        headline_style: "solid",
        subheadline: "MMD Delivery builds production-grade logistics for customers, drivers, restaurants, sellers, and businesses — with live GPS and Stripe-secured payments.",
        showcase: "image",
        image_url: "/brand/hero/hero-rider.webp",
        benefits: ["Multi-service platform","Live GPS dispatch","Stripe-secured payments"],
        primary_ctas: [{"label":"Contact us","href":"/contact","event":"cta_contact"}],
        secondary_ctas: [{"label":"Careers","href":"/careers","event":"cta_careers"}],
      },
    },
    {
      id: "company-features",
      ...base,
      block_type: "features",
      sort_order: 20,
      payload: {
        title: "What we stand for",
        items: [{"title":"Customer trust","description":"Pay-then-create integrity and live tracking so every trip and order stays transparent."},{"title":"Partner success","description":"Tools for drivers, restaurants, and sellers that match real day-to-day operations."},{"title":"Business control","description":"Corporate wallets, approvals, and reporting for teams that need spend discipline."},{"title":"Production reliability","description":"Identity, dispatch, and payments designed for scale — not prototypes."}],
      },
    },
    {
      id: "company-steps",
      ...base,
      block_type: "how_it_works",
      sort_order: 30,
      payload: {
        title: "How we work with you",
        anchor: "company-path",
        steps: COMPANY_START_STEPS.map((step) => ({ ...step })),
      },
    },
    {
      id: "company-rich",
      ...base,
      block_type: "rich_text",
      sort_order: 40,
      payload: {
        title: "About MMD Delivery",
        body_md: "MMD Delivery is a multi-service platform focused on reliable local logistics. We combine live GPS, Stripe payments, and role-based tools so every participant can operate with confidence.\n\n[Contact the team](/contact)",
      },
    },
    {
      id: "company-cta",
      ...base,
      block_type: "cta",
      sort_order: 50,
      payload: {
        title: "Build with us",
        body: "Whether you are hiring, partnering, or launching a business account — start a conversation.",
        buttons: [{"label":"Contact us","href":"/contact","event":"cta_contact"},{"label":"View careers","href":"/careers","event":"cta_careers"}],
      },
    },
    {
      id: "company-faq",
      ...base,
      block_type: "faq",
      sort_order: 60,
      payload: {
        title: "Company FAQ",
        source: "site_faq",
      },
    }
  ];
}
