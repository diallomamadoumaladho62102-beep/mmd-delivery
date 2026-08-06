import type { SiteBlockRow } from "@/lib/siteCms";

export const DRIVERS_SEO = {
  title: "Drive with MMD — MMD Delivery",
  description:
    "Become a driver with MMD Delivery. Accept flexible missions across taxi, food, and packages. Track earnings and cash out via Stripe Connect when eligible.",
  robots: "index,follow",
} as const;

export const DRIVERS_START_STEPS = [
  {
    title: "Sign up",
    body: "Create your driver account and choose the services you want to offer.",
  },
  {
    title: "Get verified",
    body: "Complete identity and vehicle checks so you can go online safely.",
  },
  {
    title: "Accept missions",
    body: "Receive taxi, food, and package jobs with live GPS and clear payouts.",
  },
  {
    title: "Earn & cash out",
    body: "Track earnings in your wallet and cash out via Stripe Connect when eligible.",
  },
] as const;

export function buildDriversFallbackBlocks(): SiteBlockRow[] {
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
      id: "drivers-hero",
      ...base,
      block_type: "hero",
      sort_order: 10,
      payload: {
        eyebrow: "Drivers",
        headline: "Drive with MMD",
        subheadline:
          "Earn with flexible missions across taxi, food, and packages — secure payouts, live GPS, and a driver wallet built for production operations.",
        showcase: "image",
        image_url: "/brand/services/taxi.webp",
        benefits: [
          "Flexible multi-service missions",
          "Stripe Connect payouts",
          "Live GPS dispatch",
        ],
        primary_ctas: [
          {
            label: "Get started",
            href: "/signup/driver",
            event: "cta_driver",
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
      id: "drivers-features",
      ...base,
      block_type: "features",
      sort_order: 20,
      payload: {
        title: "Why drive with MMD",
        items: [
          {
            title: "Multi-service earnings",
            description:
              "Accept missions across taxi, food delivery, and packages from one driver experience.",
          },
          {
            title: "Transparent wallet",
            description:
              "Track earnings clearly and cash out through Stripe Connect when you are eligible.",
          },
          {
            title: "Live GPS tools",
            description:
              "Navigate jobs with real-time tracking for pickups, drops, and customer ETAs.",
          },
          {
            title: "Production-grade ops",
            description:
              "Identity, dispatch, and payouts designed for reliable day-to-day driving — not prototypes.",
          },
        ],
      },
    },
    {
      id: "drivers-steps",
      ...base,
      block_type: "how_it_works",
      sort_order: 30,
      payload: {
        title: "How to start driving",
        anchor: "start-driving",
        steps: DRIVERS_START_STEPS.map((step) => ({ ...step })),
      },
    },
    {
      id: "drivers-payouts",
      ...base,
      block_type: "rich_text",
      sort_order: 40,
      payload: {
        title: "Payouts you can trust",
        body_md:
          "Join MMD as a driver. Accept missions across taxi, food, and packages. Track earnings in your wallet and cash out via Stripe Connect when eligible.\n\n[Get started](/signup/driver)",
      },
    },
    {
      id: "drivers-cta",
      ...base,
      block_type: "cta",
      sort_order: 50,
      payload: {
        title: "Ready to earn with MMD?",
        body: "Create your driver account and start accepting missions when verification is complete.",
        buttons: [
          {
            label: "Become a driver",
            href: "/signup/driver",
            event: "cta_driver",
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
      id: "drivers-faq",
      ...base,
      block_type: "faq",
      sort_order: 60,
      payload: {
        title: "Driver FAQ",
        source: "site_faq",
      },
    },
  ];
}
