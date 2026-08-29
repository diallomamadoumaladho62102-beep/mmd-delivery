export const LEGAL_SUPPORT_EMAIL = "support@mmddelivery.com";
export const LEGAL_SUPPORT_PHONE = "+1 (929) 492-4563";
export const LEGAL_UPDATED = "August 27, 2026";

export const PRIVACY_SEO = {
  title: "Privacy Policy — MMD Delivery",
  description:
    "How MMD Delivery collects, uses, and protects personal information, including SMS and phone communications, for taxi, food, package, marketplace, and business services.",
  robots: "index,follow",
} as const;

export const TERMS_SEO = {
  title: "Terms of Service — MMD Delivery",
  description:
    "Terms for using MMD Delivery, including the SMS messaging program, HELP and STOP instructions, payments, and acceptable use.",
  robots: "index,follow",
} as const;

export const PRIVACY_SECTIONS: { id: string; title: string; body_md: string }[] = [
  {
    id: "privacy-intro",
    title: "About this policy",
    body_md: `This Privacy Policy describes how **MMD Delivery** ("we", "us") collects, uses, shares, and protects personal information when you use our website, mobile apps, and related services at [https://www.mmddelivery.com](https://www.mmddelivery.com).

MMD Delivery is a multi-sided logistics platform for taxi rides, food delivery, package delivery, marketplace orders, restaurant operations, driver work, and business accounts.

Last updated: ${LEGAL_UPDATED}.`,
  },
  {
    id: "privacy-collect",
    title: "Information we collect",
    body_md: `We collect information you provide and information created when you use the platform, including:

**Account and identity.** Name, email address, phone number, password or authentication data, profile photo, preferred language, role (customer, driver, restaurant, seller, or business), and identity-verification documents when required.

**Orders, rides, and deliveries.** Pickup and drop-off addresses, restaurant and marketplace order contents, quotes, payment status, chat messages related to a job, delivery proof photos, ratings, and support tickets.

**Location.** Precise location during active taxi rides, deliveries, and driver shifts so we can dispatch, navigate, show live tracking, and complete jobs. We also use approximate location to show nearby availability.

**Device and app data.** Device type, operating system, app version, push-notification tokens, language settings, IP address, and diagnostic logs needed to operate and secure the service.

**Communications.** Phone numbers used for SMS verification and transactional messages; records of masked in-app calls during active trips; emails you send to support; and newsletter sign-ups if you subscribe.

**Payments.** Payment method details are processed by Stripe. We store payment references, amounts, currency, and payout eligibility data. We do not store full card numbers on MMD Delivery servers.`,
  },
  {
    id: "privacy-use",
    title: "How we use information",
    body_md: `We use personal information to:

create and secure accounts; verify phone numbers; match customers with drivers, restaurants, and sellers; calculate quotes; process payments and payouts; send order, ride, and delivery updates; provide in-app chat and masked calling during active jobs; prevent fraud and abuse; comply with law; and improve reliability and safety.

We may also send service emails and, **only if you have explicitly opted in**, SMS about your account or an active transaction. Providing a phone number or creating an account is not SMS consent. We do not sell your personal information.`,
  },
  {
    id: "privacy-protect",
    title: "How we protect information",
    body_md: `We host application data with **Supabase** under access controls, encryption in transit, and role-based permissions. Payments are processed by **Stripe**. SMS, phone verification, and masked calling are delivered through **Twilio** as a service provider.

Access to production systems is limited to authorized staff. You can **delete your account in the MMD Delivery app** (Settings / Security → Delete account) for customer, driver, restaurant, and marketplace seller accounts created in the app. You can also request deletion on the web at [https://www.mmddelivery.com/legal/account-deletion](/legal/account-deletion), by emailing [${LEGAL_SUPPORT_EMAIL}](mailto:${LEGAL_SUPPORT_EMAIL}), or using the [contact form](/contact). Some records (for example payment, tax, or fraud logs) may be retained as required by law.`,
  },
  {
    id: "privacy-sms",
    title: "SMS and phone communications",
    body_md: `The **MMD Delivery** messaging program sends informational and transactional SMS only after you give **explicit opt-in** on the public [SMS program page](/legal/sms) or the matching checkbox in the website or app. Creating an account, providing a mobile number, or accepting our Terms is **not** SMS consent.

When you have opted in, we may send: one-time **phone verification** codes when you request them; **transactional SMS** about account security, orders, deliveries, package deliveries, taxi rides, and customer support. Masked calling during an active job is a voice feature, not this SMS program.

Message frequency varies with your activity. **Message and data rates may apply.**

**Opt in:** [https://www.mmddelivery.com/legal/sms](/legal/sms). The SMS checkbox is unchecked by default and is optional.

**Opt out of SMS:** reply **STOP** (also STOPALL, UNSUBSCRIBE, CANCEL, END, or QUIT). You will receive a confirmation, and we will stop SMS to that number unless you opt in again on the SMS page or, if you previously opted in, by replying START.

**Help:** reply **HELP**, email [${LEGAL_SUPPORT_EMAIL}](mailto:${LEGAL_SUPPORT_EMAIL}), or call [${LEGAL_SUPPORT_PHONE}](tel:+19294924563).

Carriers are not liable for delayed or undelivered messages. Our [Terms of Service](/legal/terms) include the full messaging terms.`,
  },
  {
    id: "privacy-sharing",
    title: "Information sharing",
    body_md: `We share information only as needed to operate the platform:

**Other users on a job.** Customers, drivers, restaurants, and sellers see the details required to fulfill an order or ride (for example pickup address, order items, first name, vehicle info, or live location during the job).

**Service providers.** Supabase (hosting and database), Stripe (payments and Connect payouts), Twilio (SMS, Verify, and voice), Mapbox (maps and routing), email delivery providers, and error-monitoring tools process data on our instructions.

**Legal and safety.** We may disclose information to comply with law, enforce our terms, or protect users, the public, or MMD Delivery.

We do not sell personal information. **Mobile numbers are not shared with third parties.** Twilio processes SMS, Verify, and voice on our instructions as a service provider and does not receive numbers for its own marketing.`,
  },
  {
    id: "privacy-rights",
    title: "Your choices and requests",
    body_md: `You may update profile information in the app, control notification settings where offered, and **delete your account from inside the app** without contacting support. A public web request path is also available at [https://www.mmddelivery.com/legal/account-deletion](/legal/account-deletion). Cookie practices are described on our [Cookies](/cookies) page.

MMD Delivery is not directed at children under 13, and we do not knowingly collect their personal information.

We may update this policy. The current version is always published at [https://www.mmddelivery.com/legal/privacy](https://www.mmddelivery.com/legal/privacy). Continued use of MMD Delivery after an update means you acknowledge the published version.`,
  },
];

export const TERMS_SECTIONS: { id: string; title: string; body_md: string }[] = [
  {
    id: "terms-intro",
    title: "Agreement",
    body_md: `These Terms of Service ("Terms") govern use of **MMD Delivery** websites, mobile applications, and services, including taxi, food delivery, package delivery, marketplace, restaurant, driver, and business features.

By creating an account or using MMD Delivery, you agree to these Terms and to our [Privacy Policy](/legal/privacy). If you do not agree, do not use the service.

Last updated: ${LEGAL_UPDATED}.`,
  },
  {
    id: "terms-messaging",
    title: "MMD Delivery messaging program",
    body_md: `**Program / brand name:** MMD Delivery

**Program description.** MMD Delivery sends informational and transactional text messages about your account and platform activity. This includes phone-number verification codes when you request them, order and delivery updates, package-delivery updates, taxi ride alerts, and customer-support follow-up. We do not send marketing SMS through this program.

**Call to Action.** The public opt-in is [https://www.mmddelivery.com/legal/sms](/legal/sms). You may also use the same optional checkbox on website or app signup and profile screens. The checkbox is never pre-checked.

**Message frequency.** Frequency varies. You may receive a verification message when you request one, and additional messages when an order, delivery, or ride is created, assigned, updated, or completed. Typical volume is a few messages per transaction, not a fixed daily number.

**Rates.** Message and data rates may apply.

**Consent.** You consent only by checking the SMS opt-in box (or restoring a prior opt-in with START after STOP). Providing a mobile number, creating an account, or accepting these Terms is not consent. Consent is not a condition of purchasing any good or service. You may use MMD Delivery without SMS.

**HELP.** Reply **HELP** to any MMD Delivery SMS, email [${LEGAL_SUPPORT_EMAIL}](mailto:${LEGAL_SUPPORT_EMAIL}), call [${LEGAL_SUPPORT_PHONE}](tel:+19294924563), or use [https://www.mmddelivery.com/contact](https://www.mmddelivery.com/contact) and [https://www.mmddelivery.com/legal/support](https://www.mmddelivery.com/legal/support).

**STOP / opt-out.** Reply **STOP** to cancel SMS. You will receive a one-time confirmation. After that we will not send further SMS to that number unless you opt in again. You may continue to receive in-app and email notices.

**Delivery.** Carriers are not liable for delayed or undelivered messages. See the [Privacy Policy](/legal/privacy) for how phone numbers are used and shared with our SMS provider.`,
  },
  {
    id: "terms-services",
    title: "Platform services",
    body_md: `You agree to follow applicable laws, provide accurate account information, and use MMD Delivery only for legitimate transportation, food, package, marketplace, and business logistics.

Drivers, restaurants, sellers, and businesses must meet onboarding, identity, vehicle, and payout requirements that apply to their role. We may suspend or close accounts that abuse users, evade payments, or misuse platform systems.`,
  },
  {
    id: "terms-payments",
    title: "Payments and refunds",
    body_md: `Payments are processed by **Stripe**. Card-paid orders and rides are created only after payment confirmation. Refunds, cancellations, commissions, and payouts follow the rules shown in the app for that service and Stripe's processes. Chargebacks and disputes are handled according to card-network and Stripe rules.`,
  },
  {
    id: "terms-law",
    title: "Acceptable use and changes",
    body_md: `You may not interfere with the platform, scrape it without permission, submit false reports, or use MMD Delivery to transport illegal items.

These Terms may be updated. The current version is published at [https://www.mmddelivery.com/legal/terms](https://www.mmddelivery.com/legal/terms). Questions: [${LEGAL_SUPPORT_EMAIL}](mailto:${LEGAL_SUPPORT_EMAIL}) or the [contact form](/contact).`,
  },
];

export const COOKIES_SEO = {
  title: "Cookies — MMD Delivery",
  description:
    "How MMD Delivery uses necessary cookies and similar storage on the website, including locale and session preferences.",
  robots: "index,follow",
} as const;

export const COOKIES_SECTIONS: { id: string; title: string; body_md: string }[] = [
  {
    id: "cookies-intro",
    title: "Cookie policy",
    body_md: `This page describes how **MMD Delivery** uses cookies and similar storage on [https://www.mmddelivery.com](https://www.mmddelivery.com).

Last updated: ${LEGAL_UPDATED}.

The mobile apps use device permissions and local storage (for example session tokens and language) rather than website cookies. See the [Privacy Policy](/legal/privacy) for the full data practices.`,
  },
  {
    id: "cookies-types",
    title: "Cookies we use",
    body_md: `We use **necessary** cookies and similar storage to operate the site:

**Session and security.** Authentication and abuse-prevention cookies needed to keep you signed in on web account surfaces and to protect forms.

**Preferences.** Locale or language preference (for example \`mmd_web_locale\`) so the site can remember the language you chose.

We do **not** run third-party advertising cookies on the marketing site, and we do not sell cookie data.`,
  },
  {
    id: "cookies-choices",
    title: "Your choices",
    body_md: `You can block or delete cookies in your browser settings. Necessary cookies may be required for sign-in or language preference to work.

Questions: [${LEGAL_SUPPORT_EMAIL}](mailto:${LEGAL_SUPPORT_EMAIL}) or the [contact form](/contact). Related pages: [Privacy](/legal/privacy), [Terms](/legal/terms), [account deletion](/legal/account-deletion).`,
  },
];
