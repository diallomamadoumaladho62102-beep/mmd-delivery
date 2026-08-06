import type { SiteBlockRow } from "@/lib/siteCms";

export const TERMS_SEO = {
  title: "Terms of Service — MMD Delivery",
  description: "Terms governing use of MMD Delivery services for customers, drivers, restaurants, sellers, and businesses.",
  robots: "index,follow",
} as const;

export function buildTermsFallbackBlocks(): SiteBlockRow[] {
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
      id: "terms-hero",
      ...base,
      block_type: "hero",
      sort_order: 10,
      payload: {
        eyebrow: "Legal",
        headline: "Terms of Service",
        headline_style: "solid",
        subheadline: "The rules for using MMD Delivery across taxi, food, packages, marketplace, and business services.",
        showcase: "image",
        image_url: "/brand/og-transparent-v2.png",
        benefits: ["Service rules","Payments & refunds","Acceptable use"],
        primary_ctas: [{"label":"Contact support","href":"/contact","event":"cta_contact"}],
        secondary_ctas: [{"label":"Privacy Policy","href":"/legal/privacy","event":"cta_privacy"}],
      },
    },
    {
      id: "terms-rich",
      ...base,
      block_type: "rich_text",
      sort_order: 20,
      payload: {
        title: "Terms of Service",
        body_md: "By using MMD Delivery you agree to follow applicable laws, provide accurate account information, and use the platform only for legitimate transportation, delivery, marketplace, and business logistics purposes.\n\nPayments are processed by Stripe. Orders and rides paid by card are created only after payment confirmation. Refunds and disputes follow Stripe and platform policies for the relevant service.\n\nWe may suspend accounts that abuse drivers, restaurants, customers, or platform systems. For questions, contact support@mmddelivery.com or use the [contact form](/contact).",
      },
    },
    {
      id: "terms-cta",
      ...base,
      block_type: "cta",
      sort_order: 30,
      payload: {
        title: "Need clarification?",
        body: "Our support team can help explain how these terms apply to your account.",
        buttons: [{"label":"Contact support","href":"/contact","event":"cta_contact"},{"label":"FAQ","href":"/faq","event":"cta_faq"}],
      },
    }
  ];
}
