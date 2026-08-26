import type { SiteBlockRow } from "@/lib/siteCms";

export const SUPPORT_SEO = {
  title: "Support — MMD Delivery",
  description: "Get help with MMD Delivery accounts, orders, payouts, and partner onboarding.",
  robots: "index,follow",
} as const;

export function buildSupportFallbackBlocks(): SiteBlockRow[] {
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
      id: "support-hero",
      ...base,
      block_type: "hero",
      sort_order: 10,
      payload: {
        eyebrow: "Support",
        headline: "Help when you need it",
        headline_style: "solid",
        subheadline: "Find answers fast in the FAQ, or contact the team for account, order, and payout support.",
        showcase: "image",
        image_url: "/brand/services/taxi.webp",
        benefits: ["FAQ self-serve","Email and SMS help","STOP / HELP keywords"],
        primary_ctas: [{"label":"Contact support","href":"/contact","event":"cta_contact"}],
        secondary_ctas: [{"label":"Browse FAQ","href":"/faq","event":"cta_faq"}],
      },
    },
    {
      id: "support-rich",
      ...base,
      block_type: "rich_text",
      sort_order: 20,
      payload: {
        title: "Support channels",
        body_md: "Start with the FAQ for common questions about payments, delivery timing, drivers, and business accounts.\n\nEmail support@mmddelivery.com or use the [contact form](/contact). Include your order or ride reference when possible.\n\n**SMS help.** Reply **HELP** to any MMD Delivery text, call +1 (929) 492-4563, or review the public program and opt-in at [https://www.mmddelivery.com/legal/sms](/legal/sms). Reply **STOP** to cancel SMS. Message frequency varies. Message and data rates may apply.\n\nWebsite: https://www.mmddelivery.com",
      },
    },
    {
      id: "support-cta",
      ...base,
      block_type: "cta",
      sort_order: 30,
      payload: {
        title: "Talk to a human",
        body: "Send a message and our team will help you resolve the issue.",
        buttons: [{"label":"Contact support","href":"/contact","event":"cta_contact"},{"label":"SMS program","href":"/legal/sms","event":"cta_sms"}],
      },
    },
    {
      id: "support-faq",
      ...base,
      block_type: "faq",
      sort_order: 40,
      payload: {
        title: "Support FAQ",
        source: "site_faq",
      },
    }
  ];
}
