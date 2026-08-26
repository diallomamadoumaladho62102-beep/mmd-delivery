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
        body_md: "Start with the FAQ for common questions about payments, delivery timing, drivers, and business accounts.\n\nEmail support@mmddelivery.com or use the [contact form](/contact). Include your order or ride reference when possible.\n\n**SMS help.** Reply **HELP** to any MMD Delivery text, call +1 (929) 492-4563, or review the public program and opt-in at [https://www.mmddelivery.com/legal/sms](/legal/sms). Reply **STOP** to cancel SMS. Message frequency varies. Message and data rates may apply. Consent is not a condition of purchase.\n\n**Aide SMS.** Répondez **HELP** à n’importe quel SMS MMD Delivery, écrivez à support@mmddelivery.com, ou appelez le +1 (929) 492-4563. Répondez **STOP** pour vous désinscrire. La fréquence des messages varie. Des frais de messages et de données peuvent s’appliquer. Le consentement n’est pas une condition d’achat. Programme public : [https://www.mmddelivery.com/legal/sms](/legal/sms).\n\nWebsite: https://www.mmddelivery.com",
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

const SMS_HELP_MARKERS = ["Reply **HELP**", "Reply **STOP**", "/legal/sms"];

export function supportBlocksIncludeSmsHelp(blocks: SiteBlockRow[]): boolean {
  return blocks.some((block) => {
    const payload = block.payload ?? {};
    const body = String(payload.body_md ?? payload.body ?? "");
    const benefits = Array.isArray(payload.benefits)
      ? payload.benefits.map((item) => String(item)).join(" ")
      : "";
    const haystack = `${body} ${benefits}`.toLowerCase();
    return SMS_HELP_MARKERS.every((marker) =>
      haystack.includes(marker.toLowerCase()),
    );
  });
}

/** Always-visible SMS HELP/STOP block so CMS pages cannot hide the A2P support URL. */
export function buildSupportSmsHelpBlocks(
  sortOrderStart = 25,
): SiteBlockRow[] {
  const now = new Date().toISOString();
  return [
    {
      id: "support-sms-help",
      page_id: "fallback",
      visible: true,
      status: "published",
      published_at: now,
      scheduled_for: null,
      block_type: "rich_text",
      sort_order: sortOrderStart,
      payload: {
        title: "SMS help (HELP / STOP)",
        body_md:
          "**SMS help.** Reply **HELP** to any MMD Delivery text, email support@mmddelivery.com, or call +1 (929) 492-4563. Reply **STOP** to cancel SMS. Message frequency varies. Message and data rates may apply. Consent is not a condition of purchase. Public opt-in: [https://www.mmddelivery.com/legal/sms](/legal/sms).\n\n**Aide SMS.** Répondez **HELP** à n’importe quel SMS MMD Delivery, écrivez à support@mmddelivery.com, ou appelez le +1 (929) 492-4563. Répondez **STOP** pour vous désinscrire. La fréquence des messages varie. Des frais de messages et de données peuvent s’appliquer. Le consentement n’est pas une condition d’achat. Programme public : [https://www.mmddelivery.com/legal/sms](/legal/sms).",
      },
    },
  ];
}

export function withSupportSmsHelpBlocks(blocks: SiteBlockRow[]): SiteBlockRow[] {
  if (supportBlocksIncludeSmsHelp(blocks)) return blocks;
  const maxSort = blocks.reduce(
    (max, block) => Math.max(max, Number(block.sort_order) || 0),
    0,
  );
  return [...blocks, ...buildSupportSmsHelpBlocks(maxSort + 5)];
}
