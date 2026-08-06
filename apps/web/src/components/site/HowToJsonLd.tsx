import { CANONICAL_SITE_ORIGIN } from "@/lib/productionSite";

export type HowToStep = {
  title: string;
  body?: string;
};

/**
 * Schema.org HowTo JSON-LD for marketing pages with step flows.
 * Steps should match the published CMS `how_it_works` block when present.
 */
export default function HowToJsonLd({
  name = "How MMD Delivery works",
  description = "From quote to delivery with secure Stripe payment and live tracking.",
  path = "/how-it-works",
  anchor = "how-it-works",
  steps,
}: {
  name?: string;
  description?: string;
  path?: string;
  anchor?: string;
  steps: HowToStep[];
}) {
  const cleaned = steps
    .map((step) => ({
      title: step.title.trim(),
      body: step.body?.trim() || undefined,
    }))
    .filter((step) => step.title);
  if (!cleaned.length) return null;

  const pageUrl = `${CANONICAL_SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;
  const stepUrl = `${pageUrl}#${anchor}`;

  const data = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name,
    description,
    url: pageUrl,
    step: cleaned.map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: step.title,
      text: step.body || step.title,
      url: stepUrl,
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
