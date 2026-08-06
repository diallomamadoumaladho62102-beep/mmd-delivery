import type { SiteBlockRow } from "@/lib/siteCms";

export const CONTACT_SEO = {
  title: "Contact — MMD Delivery",
  description: "Contact MMD Delivery support for orders, partnerships, business accounts, and press inquiries.",
  robots: "index,follow",
} as const;

export function buildContactFallbackBlocks(): SiteBlockRow[] {
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
      id: "contact-hero",
      ...base,
      block_type: "hero",
      sort_order: 10,
      payload: {
        eyebrow: "Contact",
        headline: "We're here to help",
        headline_style: "solid",
        subheadline: "Message our team for customer support, restaurant or driver onboarding, business accounts, and partnership requests.",
        showcase: "image",
        image_url: "/brand/services/package.webp",
        benefits: ["support@mmddelivery.com","Partnerships & press","Business onboarding"],
        primary_ctas: [{"label":"Send a message","href":"/contact#contact-form","event":"cta_contact_form"}],
        secondary_ctas: [{"label":"FAQ","href":"/faq","event":"cta_faq"}],
      },
    },
    {
      id: "contact-contact",
      ...base,
      block_type: "contact",
      sort_order: 20,
      payload: {
        title: "Send a message",
        anchor: "contact-form",
      },
    },
    {
      id: "contact-rich",
      ...base,
      block_type: "rich_text",
      sort_order: 30,
      payload: {
        title: "How to reach us",
        body_md: "Use the form on this page for the fastest response. You can also email support@mmddelivery.com for account and delivery questions.\n\n[Browse FAQ](/faq)",
      },
    },
    {
      id: "contact-cta",
      ...base,
      block_type: "cta",
      sort_order: 40,
      payload: {
        title: "Prefer the app?",
        body: "Download MMD Delivery for live order tracking and in-app support tools.",
        buttons: [{"label":"Download the app","href":"/download","event":"cta_download"},{"label":"How it works","href":"/how-it-works","event":"cta_how_it_works"}],
      },
    },
    {
      id: "contact-faq",
      ...base,
      block_type: "faq",
      sort_order: 50,
      payload: {
        title: "Quick answers",
        source: "site_faq",
      },
    }
  ];
}
