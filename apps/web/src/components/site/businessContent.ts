import type { SiteBlockRow } from "@/lib/siteCms";

export const BUSINESS_SEO = {
  title: "Business — MMD Delivery",
  description:
    "Run corporate rides with MMD Delivery. Shared business wallets, team members, and approval workflows built for production operations.",
  robots: "index,follow",
} as const;

export const BUSINESS_START_STEPS = [
  {
    title: "Create your business account",
    body: "Sign up, add your company profile, and set the basics for billing and support contacts.",
  },
  {
    title: "Fund your business wallet",
    body: "Top up the shared wallet so approved rides can be charged without personal cards.",
  },
  {
    title: "Invite your team",
    body: "Add members, set roles, and control who can request or approve corporate rides.",
  },
  {
    title: "Approve & ride",
    body: "Review pending requests, approve rides, and track live trips with clear spend reporting.",
  },
] as const;

export function buildBusinessFallbackBlocks(): SiteBlockRow[] {
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
      id: "business-hero",
      ...base,
      block_type: "hero",
      sort_order: 10,
      payload: {
        eyebrow: "Business",
        headline: "Move your team with MMD",
        headline_style: "solid",
        subheadline:
          "Corporate wallets, member roles, and ride approvals — live GPS and production-grade spend control for every business trip.",
        showcase: "image",
        image_url: "/brand/services/taxi.webp",
        benefits: [
          "Shared business wallet",
          "Team roles & approvals",
          "Live ride tracking",
        ],
        primary_ctas: [
          {
            label: "Contact sales",
            href: "/contact",
            event: "cta_business",
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
      id: "business-features",
      ...base,
      block_type: "features",
      sort_order: 20,
      payload: {
        title: "Why businesses choose MMD",
        items: [
          {
            title: "Centralized wallet control",
            description:
              "Fund one business wallet and keep every approved ride on the company balance — not scattered personal cards.",
          },
          {
            title: "Approvals that protect spend",
            description:
              "Members request rides; admins approve before dispatch so budgets stay intentional.",
          },
          {
            title: "Roles for real teams",
            description:
              "Invite colleagues with clear permissions for requesting, approving, and reviewing activity.",
          },
          {
            title: "Production-grade reliability",
            description:
              "Identity, dispatch, and payments designed for day-to-day corporate operations — not prototypes.",
          },
        ],
      },
    },
    {
      id: "business-steps",
      ...base,
      block_type: "how_it_works",
      sort_order: 30,
      payload: {
        title: "How to start with Business",
        anchor: "start-business",
        steps: BUSINESS_START_STEPS.map((step) => ({ ...step })),
      },
    },
    {
      id: "business-ops",
      ...base,
      block_type: "rich_text",
      sort_order: 40,
      payload: {
        title: "Operations built for companies",
        body_md:
          "Join MMD Business. Fund a shared wallet, invite your team, approve rides, and track every trip with live GPS. Built for production spend control.\n\n[Contact sales](/contact)",
      },
    },
    {
      id: "business-cta",
      ...base,
      block_type: "cta",
      sort_order: 50,
      payload: {
        title: "Ready to move your team?",
        body: "Talk with our team to open a business wallet, invite members, and start approving corporate rides.",
        buttons: [
          {
            label: "Contact sales",
            href: "/contact",
            event: "cta_business",
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
      id: "business-faq",
      ...base,
      block_type: "faq",
      sort_order: 60,
      payload: {
        title: "Business FAQ",
        source: "site_faq",
      },
    },
  ];
}
