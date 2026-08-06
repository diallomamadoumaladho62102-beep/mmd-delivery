import type { SiteBlockRow } from "@/lib/siteCms";

export const MARKETPLACE_SEO = {
  title: "Marketplace — MMD Delivery",
  description:
    "Shop local sellers on MMD Marketplace. Browse products, checkout securely with Stripe, and get delivery with live tracking across Mauritius.",
  robots: "index,follow",
} as const;

export const MARKETPLACE_START_STEPS = [
  {
    title: "Browse local sellers",
    body: "Discover products from verified sellers with clear pricing and availability.",
  },
  {
    title: "Add to cart & checkout",
    body: "Pay securely with Stripe — orders are created only after payment confirms.",
  },
  {
    title: "Track your delivery",
    body: "Follow pickup and drop-off with live status updates through to your door.",
  },
  {
    title: "Sell on MMD",
    body: "Publish your catalog, fulfill orders, and grow with production-grade marketplace ops.",
  },
] as const;

export function buildMarketplaceFallbackBlocks(): SiteBlockRow[] {
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
      id: "marketplace-hero",
      ...base,
      block_type: "hero",
      sort_order: 10,
      payload: {
        eyebrow: "Marketplace",
        headline: "Shop local with MMD",
        headline_style: "solid",
        subheadline:
          "Local sellers, secure checkout, and delivery built into the same production platform as taxi, food, and packages.",
        showcase: "image",
        image_url: "/brand/services/marketplace.webp",
        benefits: [
          "Local verified sellers",
          "Stripe-secured checkout",
          "Live delivery tracking",
        ],
        primary_ctas: [
          {
            label: "Download the app",
            href: "/download",
            event: "cta_marketplace_download",
          },
        ],
        secondary_ctas: [
          {
            label: "How it works",
            href: "/how-it-works",
            event: "cta_how_it_works",
          },
        ],
      },
    },
    {
      id: "marketplace-features",
      ...base,
      block_type: "features",
      sort_order: 20,
      payload: {
        title: "Why shop on MMD Marketplace",
        items: [
          {
            title: "Local-first catalog",
            description:
              "Discover sellers near you with product pages built for clear pricing and availability.",
          },
          {
            title: "Pay-then-create integrity",
            description:
              "Card checkouts create the order only after Stripe confirms payment — safer for buyers and sellers.",
          },
          {
            title: "Delivery included",
            description:
              "Marketplace orders move through the same live dispatch and tracking stack as the rest of MMD.",
          },
          {
            title: "Production-grade reliability",
            description:
              "Identity, payments, and fulfillment designed for day-to-day commerce — not prototypes.",
          },
        ],
      },
    },
    {
      id: "marketplace-steps",
      ...base,
      block_type: "how_it_works",
      sort_order: 30,
      payload: {
        title: "How Marketplace works",
        anchor: "start-marketplace",
        steps: MARKETPLACE_START_STEPS.map((step) => ({ ...step })),
      },
    },
    {
      id: "marketplace-ops",
      ...base,
      block_type: "rich_text",
      sort_order: 40,
      payload: {
        title: "Buy and sell with confidence",
        body_md:
          "MMD Marketplace connects local sellers with customers who expect secure payments and reliable delivery. Browse the catalog in the app, checkout with Stripe, and track every order.\n\n[Download the app](/download)",
      },
    },
    {
      id: "marketplace-cta",
      ...base,
      block_type: "cta",
      sort_order: 50,
      payload: {
        title: "Ready to shop local?",
        body: "Download MMD Delivery to browse sellers, checkout securely, and track marketplace deliveries.",
        buttons: [
          {
            label: "Download the app",
            href: "/download",
            event: "cta_marketplace_download",
          },
          {
            label: "How it works",
            href: "/how-it-works",
            event: "cta_how_it_works",
          },
        ],
      },
    },
    {
      id: "marketplace-faq",
      ...base,
      block_type: "faq",
      sort_order: 60,
      payload: {
        title: "Marketplace FAQ",
        source: "site_faq",
      },
    },
  ];
}
