import type { SiteBlockRow } from "@/lib/siteCms";

export const RESTAURANTS_SEO = {
  title: "Partner restaurants — MMD Delivery",
  description:
    "Grow your restaurant with MMD Delivery. Publish menus, receive orders in real time, and get paid through Stripe Connect with production-grade ops.",
  robots: "index,follow",
} as const;

export const RESTAURANTS_START_STEPS = [
  {
    title: "Create your restaurant",
    body: "Sign up, add your location, hours, and brand details so customers can find you.",
  },
  {
    title: "Publish your menu",
    body: "Upload items, modifiers, and pricing with clear availability for every service window.",
  },
  {
    title: "Go live for orders",
    body: "Accept food delivery orders with live status updates for the kitchen and drivers.",
  },
  {
    title: "Earn & get paid",
    body: "Track sales in your restaurant wallet and cash out via Stripe Connect when eligible.",
  },
] as const;

export function buildRestaurantsFallbackBlocks(): SiteBlockRow[] {
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
      id: "restaurants-hero",
      ...base,
      block_type: "hero",
      sort_order: 10,
      payload: {
        eyebrow: "Restaurants",
        headline: "Partner with MMD",
        headline_style: "solid",
        subheadline:
          "Reach more customers with reliable food delivery — live order ops, clear payouts, and a restaurant experience built for production kitchens.",
        showcase: "image",
        image_url: "/brand/services/food.webp",
        benefits: [
          "Real-time order intake",
          "Stripe Connect payouts",
          "Kitchen-ready ops tools",
        ],
        primary_ctas: [
          {
            label: "Become a partner",
            href: "/signup/restaurant",
            event: "cta_restaurant",
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
      id: "restaurants-features",
      ...base,
      block_type: "features",
      sort_order: 20,
      payload: {
        title: "Why restaurants choose MMD",
        items: [
          {
            title: "Orders that stay in sync",
            description:
              "Receive paid orders with clear statuses for prep, pickup, and delivery — not fragmented chat threads.",
          },
          {
            title: "Transparent restaurant wallet",
            description:
              "Track sales and payouts clearly, then cash out through Stripe Connect when you are eligible.",
          },
          {
            title: "Menu control that scales",
            description:
              "Publish items, modifiers, and availability windows so customers always see what you can fulfill.",
          },
          {
            title: "Production-grade reliability",
            description:
              "Identity, dispatch, and payments designed for day-to-day restaurant operations — not prototypes.",
          },
        ],
      },
    },
    {
      id: "restaurants-steps",
      ...base,
      block_type: "how_it_works",
      sort_order: 30,
      payload: {
        title: "How to start partnering",
        anchor: "start-partnering",
        steps: RESTAURANTS_START_STEPS.map((step) => ({ ...step })),
      },
    },
    {
      id: "restaurants-ops",
      ...base,
      block_type: "rich_text",
      sort_order: 40,
      payload: {
        title: "Operations you can trust",
        body_md:
          "Join MMD as a restaurant partner. Publish your menu, accept delivery orders, and track earnings in your wallet. Cash out via Stripe Connect when eligible.\n\n[Become a partner](/signup/restaurant)",
      },
    },
    {
      id: "restaurants-cta",
      ...base,
      block_type: "cta",
      sort_order: 50,
      payload: {
        title: "Ready to grow with MMD?",
        body: "Create your restaurant account and start accepting delivery orders when verification is complete.",
        buttons: [
          {
            label: "Become a partner",
            href: "/signup/restaurant",
            event: "cta_restaurant",
          },
          {
            label: "Contact support",
            href: "/contact",
            event: "cta_contact",
          },
        ],
      },
    },
    {
      id: "restaurants-faq",
      ...base,
      block_type: "faq",
      sort_order: 60,
      payload: {
        title: "Restaurant FAQ",
        source: "site_faq",
      },
    },
  ];
}
