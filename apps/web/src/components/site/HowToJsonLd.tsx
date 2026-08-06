import { CANONICAL_SITE_ORIGIN } from "@/lib/productionSite";

export type HowToStep = {
  title: string;
  body?: string;
};

/**
 * Schema.org HowTo JSON-LD for the marketing How it works page.
 * Steps should match the published CMS `how_it_works` block.
 */
export default function HowToJsonLd({
  name = "How MMD Delivery works",
  description = "From quote to delivery with secure Stripe payment and live tracking.",
  steps,
}: {
  name?: string;
  description?: string;
  steps: HowToStep[];
}) {
  const cleaned = steps
    .map((step) => ({
      title: step.title.trim(),
      body: step.body?.trim() || undefined,
    }))
    .filter((step) => step.title);
  if (!cleaned.length) return null;

  const data = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name,
    description,
    url: `${CANONICAL_SITE_ORIGIN}/how-it-works`,
    step: cleaned.map((step, index) => ({
      "@type": "HowToStep",
      position: index + 1,
      name: step.title,
      text: step.body || step.title,
      url: `${CANONICAL_SITE_ORIGIN}/how-it-works#how-it-works`,
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
