import type { SiteBlockRow } from "@/lib/siteCms";

export const PRIVACY_SEO = {
  title: "Privacy Policy — MMD Delivery",
  description: "How MMD Delivery collects, stores, and processes account, order, location, and payment data.",
  robots: "index,follow",
} as const;

export function buildPrivacyFallbackBlocks(): SiteBlockRow[] {
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
      id: "privacy-hero",
      ...base,
      block_type: "hero",
      sort_order: 10,
      payload: {
        eyebrow: "Legal",
        headline: "Privacy Policy",
        headline_style: "solid",
        subheadline: "How we handle account information, delivery data, location during active jobs, and payment processing.",
        showcase: "image",
        image_url: "/brand/og-transparent-v2.png",
        benefits: ["Supabase storage","Stripe payments","Access & deletion requests"],
        primary_ctas: [{"label":"Contact privacy","href":"/contact","event":"cta_privacy"}],
        secondary_ctas: [{"label":"Terms of Service","href":"/legal/terms","event":"cta_terms"}],
      },
    },
    {
      id: "privacy-rich",
      ...base,
      block_type: "rich_text",
      sort_order: 20,
      payload: {
        title: "Privacy Policy",
        body_md: "MMD Delivery collects account information, order and delivery data, location during active deliveries, and photos uploaded as proof. Data is stored on Supabase and processed by Stripe for payments.\n\nFor data access or deletion requests, contact support@mmddelivery.com or use the [contact form](/contact).\n\nWe update this policy as the platform evolves. Continued use of MMD Delivery means you acknowledge the latest published version.",
      },
    },
    {
      id: "privacy-cta",
      ...base,
      block_type: "cta",
      sort_order: 30,
      payload: {
        title: "Questions about privacy?",
        body: "Contact support for access, deletion, or clarification requests.",
        buttons: [{"label":"Contact support","href":"/contact","event":"cta_contact"},{"label":"Support page","href":"/legal/support","event":"cta_support"}],
      },
    }
  ];
}
