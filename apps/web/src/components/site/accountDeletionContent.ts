import type { SiteBlockRow } from "@/lib/siteCms";
import { LEGAL_SUPPORT_EMAIL, LEGAL_UPDATED } from "./legalPageCopy";

export const ACCOUNT_DELETION_SEO = {
  title: "Delete your account — MMD Delivery",
  description:
    "How to delete a MMD Delivery customer, driver, restaurant, seller, or business account in the app or by requesting deletion on the web.",
  robots: "index,follow",
} as const;

export const ACCOUNT_DELETION_URL =
  "https://www.mmddelivery.com/legal/account-deletion";

export const ACCOUNT_DELETION_SECTIONS: {
  id: string;
  title: string;
  body_md: string;
}[] = [
  {
    id: "deletion-intro",
    title: "Request account deletion",
    body_md: `This page is the **public web resource** for deleting a MMD Delivery account. You do **not** need to be logged into the mobile app to use it.

Last updated: ${LEGAL_UPDATED}.

MMD Delivery lets people create Customer, Driver, Restaurant, and Marketplace Seller accounts in the app. Taxi **Business** wallets are memberships on a Customer account — deleting that Customer account also ends business-wallet access.`,
  },
  {
    id: "deletion-in-app",
    title: "Delete in the MMD Delivery app",
    body_md: `The fastest path is inside the app (requires your password and typing DELETE):

- **Customer:** Profile or Settings → Delete account
- **Driver:** Account or Security → Delete account
- **Restaurant:** Security → Delete account
- **Marketplace Seller:** Seller Dashboard or Seller Setup → Delete account
- **Business wallet:** use the **Customer** account that owns the membership (same Delete account path)

Deletion starts immediately after you confirm. You will be signed out and will not be able to log back in.`,
  },
  {
    id: "deletion-web",
    title: "Request deletion on the web",
    body_md: `If you cannot open the app, request deletion without signing in:

1. Email [${LEGAL_SUPPORT_EMAIL}](mailto:${LEGAL_SUPPORT_EMAIL}?subject=Account%20deletion%20request) with subject **Account deletion request**.
2. Or use the [contact form](/contact) and choose a message that clearly asks to delete your account.

Include: the email on the account, the role (Customer, Driver, Restaurant, Seller, or Business), and any order or ride reference you have. We verify identity before completing deletion so someone else cannot erase your account.

We aim to complete verified web requests within **30 days**.`,
  },
  {
    id: "deletion-what",
    title: "What is deleted and what we keep",
    body_md: `When deletion runs we anonymize personal data (name, email, phone, profile photo, saved addresses, seller shop contact details) and revoke login, push tokens, and active business memberships.

We **retain** records required for payments, tax, fraud, disputes, and law — for example order and ride history identifiers, Stripe payment and payout references, and security logs. Those records are no longer tied to your live profile identity.

Founder / staff admin accounts cannot be self-deleted through this flow.`,
  },
];

export function buildAccountDeletionFallbackBlocks(): SiteBlockRow[] {
  const now = new Date().toISOString();
  const base = {
    page_id: "fallback",
    visible: true as const,
    status: "published" as const,
    published_at: now,
    scheduled_for: null,
  };

  const sections: SiteBlockRow[] = ACCOUNT_DELETION_SECTIONS.map(
    (section, index) => ({
      id: section.id,
      ...base,
      block_type: "rich_text",
      sort_order: 20 + index * 10,
      payload: {
        title: section.title,
        body_md: section.body_md,
      },
    }),
  );

  return [
    {
      id: "deletion-hero",
      ...base,
      block_type: "hero",
      sort_order: 10,
      payload: {
        eyebrow: "Legal",
        headline: "Delete your account",
        headline_style: "solid",
        subheadline:
          "Remove a MMD Delivery account from the app, or request deletion on this page without logging in.",
        showcase: "image",
        image_url: "/brand/og-transparent-v2.png",
        benefits: [
          "In-app deletion",
          "Web request without app login",
          "Customer, Driver, Restaurant, Seller, Business",
        ],
        primary_ctas: [
          {
            label: "Email deletion request",
            href: `mailto:${LEGAL_SUPPORT_EMAIL}?subject=Account%20deletion%20request`,
            event: "cta_account_deletion_email",
          },
        ],
        secondary_ctas: [
          { label: "Contact form", href: "/contact", event: "cta_contact" },
          { label: "Privacy Policy", href: "/legal/privacy", event: "cta_privacy" },
        ],
      },
    },
    ...sections,
    {
      id: "deletion-cta",
      ...base,
      block_type: "cta",
      sort_order: 20 + ACCOUNT_DELETION_SECTIONS.length * 10 + 10,
      payload: {
        title: "Need help deleting an account?",
        body: `Email ${LEGAL_SUPPORT_EMAIL} or use the contact form. Include the account email and role.`,
        buttons: [
          { label: "Contact support", href: "/contact", event: "cta_contact" },
          { label: "Support page", href: "/legal/support", event: "cta_support" },
        ],
      },
    },
  ];
}
