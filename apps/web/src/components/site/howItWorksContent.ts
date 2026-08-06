import type { SiteBlockRow } from "@/lib/siteCms";

/** Definitive How it works marketing composition (CMS + code fallback). */
export const HOW_IT_WORKS_STEPS = [
  {
    title: "Estimate",
    body: "Get a transparent quote before you pay.",
  },
  {
    title: "Pay securely",
    body: "Stripe confirms payment — then we create the job.",
  },
  {
    title: "Track live",
    body: "Follow dispatch, pickup, and delivery in real time.",
  },
  {
    title: "Done",
    body: "Receipts, ratings, and support when you need them.",
  },
] as const;

export const HOW_IT_WORKS_SEO = {
  title: "How it works — MMD Delivery",
  description:
    "From quote to delivery: estimate, pay securely with Stripe, create the job after payment confirmation, and track live until done.",
  robots: "index,follow",
} as const;

export function buildHowItWorksFallbackBlocks(): SiteBlockRow[] {
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
      id: "hiw-hero",
      ...base,
      block_type: "hero",
      sort_order: 10,
      payload: {
        eyebrow: "MMD Delivery",
        headline: "How it works",
        subheadline:
          "From quote to delivery — transparent pricing, pay-then-create integrity, and live tracking across taxi, food, packages, marketplace, and business.",
        showcase: "image",
        image_url: "/brand/hero/hero-rider.webp",
        benefits: ["Transparent quotes", "Pay then create", "Live GPS tracking"],
        primary_ctas: [
          {
            label: "Download the app",
            href: "/download",
            event: "store_click_web",
          },
        ],
        secondary_ctas: [
          { label: "Contact us", href: "/contact", event: "cta_contact" },
        ],
      },
    },
    {
      id: "hiw-steps",
      ...base,
      block_type: "how_it_works",
      sort_order: 20,
      payload: {
        title: "Four steps. One reliable flow.",
        steps: HOW_IT_WORKS_STEPS.map((step) => ({ ...step })),
      },
    },
    {
      id: "hiw-integrity",
      ...base,
      block_type: "rich_text",
      sort_order: 30,
      payload: {
        title: "Pay-then-create integrity",
        body_md:
          "For card payments, MMD creates the ride or order only after Stripe confirms payment. That protects customers, drivers, restaurants, and sellers — and keeps operations production-grade rather than speculative.",
      },
    },
    {
      id: "hiw-cta",
      ...base,
      block_type: "cta",
      sort_order: 40,
      payload: {
        title: "Ready to get started?",
        body: "Download the app or join as a driver, restaurant, seller, or business.",
        buttons: [
          {
            label: "Download the app",
            href: "/download",
            event: "store_click_web",
          },
          { label: "Contact us", href: "/contact", event: "cta_contact" },
        ],
      },
    },
    {
      id: "hiw-faq",
      ...base,
      block_type: "faq",
      sort_order: 50,
      payload: {
        title: "Frequently asked questions",
        source: "site_faq",
      },
    },
  ];
}
