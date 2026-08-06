import type { SiteBlockRow } from "@/lib/siteCms";

export const DOWNLOAD_SEO = {
  title: "Download — MMD Delivery",
  description: "Download MMD Delivery for iOS and Android. Access taxi, food, packages, marketplace, and business tools in one app.",
  robots: "index,follow",
} as const;

export const DOWNLOAD_START_STEPS = [
  {
    "title": "Download the app",
    "body": "Install MMD Delivery from the App Store or Google Play when available in your region."
  },
  {
    "title": "Create your account",
    "body": "Sign up as a customer — or continue partner onboarding for drivers and restaurants on the web."
  },
  {
    "title": "Choose a service",
    "body": "Book a taxi, order food, send a package, or shop the marketplace."
  },
  {
    "title": "Track live",
    "body": "Follow status updates from payment through delivery."
  }
] as const;

export function buildDownloadFallbackBlocks(): SiteBlockRow[] {
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
      id: "download-hero",
      ...base,
      block_type: "hero",
      sort_order: 10,
      payload: {
        eyebrow: "Download",
        headline: "Get MMD Delivery",
        headline_style: "solid",
        subheadline: "One app for taxi, food delivery, packages, marketplace shopping, and business logistics — with live tracking and secure payments.",
        showcase: "image",
        image_url: "/brand/mmd-logo-transparent-v2.png",
        benefits: ["iOS & Android","Live GPS tracking","Secure Stripe checkout"],
        primary_ctas: [{"label":"Download on the App Store","href":"/download#ios","event":"cta_ios"}],
        secondary_ctas: [{"label":"Get it on Google Play","href":"/download#android","event":"cta_android"}],
      },
    },
    {
      id: "download-features",
      ...base,
      block_type: "features",
      sort_order: 20,
      payload: {
        title: "What you get in the app",
        items: [{"title":"Taxi","description":"Quote, pay, ride, and track with production-grade dispatch."},{"title":"Food","description":"Order from partner restaurants with kitchen-ready status flows."},{"title":"Packages","description":"Send and receive with pickup codes and live ETAs."},{"title":"Marketplace & Business","description":"Shop local sellers or run corporate rides with approvals."}],
      },
    },
    {
      id: "download-steps",
      ...base,
      block_type: "how_it_works",
      sort_order: 30,
      payload: {
        title: "How to get started",
        anchor: "install",
        steps: DOWNLOAD_START_STEPS.map((step) => ({ ...step })),
      },
    },
    {
      id: "download-rich",
      ...base,
      block_type: "rich_text",
      sort_order: 40,
      payload: {
        title: "Store links",
        body_md: "Store buttons on this page use the official configured App Store and Play Store URLs when set, and otherwise keep you on mmddelivery.com/download.\n\n[Contact support](/contact)",
      },
    },
    {
      id: "download-cta",
      ...base,
      block_type: "cta",
      sort_order: 50,
      payload: {
        title: "Need the website instead?",
        body: "You can still explore services, partner signups, and support from the marketing site.",
        buttons: [{"label":"Back to home","href":"/","event":"cta_home"},{"label":"Contact support","href":"/contact","event":"cta_contact"}],
      },
    },
    {
      id: "download-faq",
      ...base,
      block_type: "faq",
      sort_order: 60,
      payload: {
        title: "Download FAQ",
        source: "site_faq",
      },
    }
  ];
}
