import type { Metadata } from "next";
import BlockRenderer from "@/components/site/BlockRenderer";
import HowToJsonLd from "@/components/site/HowToJsonLd";
import SiteAnalytics from "@/components/site/SiteAnalytics";
import SiteShell from "@/components/site/SiteShell";
import {
  MARKETPLACE_SEO,
  MARKETPLACE_START_STEPS,
  buildMarketplaceFallbackBlocks,
} from "@/components/site/marketplaceContent";
import {
  cmsPageMetadata,
  loadSiteChrome,
  renderCmsPage,
} from "@/components/site/renderCmsPage";
import { getPublishedPageBySlug, listPublishedFaq } from "@/lib/siteCms";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  try {
    const meta = await cmsPageMetadata("marketplace", "Marketplace");
    return {
      ...meta,
      title: meta.title || MARKETPLACE_SEO.title,
      description: meta.description || MARKETPLACE_SEO.description,
    };
  } catch {
    return {
      title: MARKETPLACE_SEO.title,
      description: MARKETPLACE_SEO.description,
      robots: MARKETPLACE_SEO.robots,
    };
  }
}

function readSteps(payload: Record<string, unknown> | undefined) {
  const steps = Array.isArray(payload?.steps) ? payload.steps : [];
  const fromCms: { title: string; body?: string }[] = [];
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const row = step as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    if (!title) continue;
    const body =
      typeof row.body === "string"
        ? row.body.trim()
        : typeof row.description === "string"
          ? row.description.trim()
          : undefined;
    fromCms.push({ title, body });
  }
  return fromCms.length > 0
    ? fromCms
    : MARKETPLACE_START_STEPS.map((step) => ({
        title: step.title,
        body: step.body,
      }));
}

export default async function MarketplaceMarketingPage() {
  const supabase = buildSupabaseAdminClient();
  const pageData = await getPublishedPageBySlug(supabase, "marketplace");
  const hasStructuredCms = Boolean(
    pageData?.blocks.some(
      (block) =>
        block.block_type === "features" || block.block_type === "how_it_works",
    ),
  );

  const stepsBlock = pageData?.blocks.find(
    (block) => block.block_type === "how_it_works",
  );
  const payload =
    stepsBlock?.payload && typeof stepsBlock.payload === "object"
      ? (stepsBlock.payload as Record<string, unknown>)
      : undefined;
  const steps = readSteps(payload);

  const jsonLd = (
    <HowToJsonLd
      name="How MMD Marketplace works"
      description={MARKETPLACE_SEO.description}
      path="/marketplace"
      anchor="start-marketplace"
      steps={steps}
    />
  );

  if (hasStructuredCms) {
    return (
      <>
        <div data-site-content-source="cms" hidden aria-hidden="true" />
        {jsonLd}
        {await renderCmsPage("marketplace")}
      </>
    );
  }

  const { settings, headerItems, footerItems, overlays } = await loadSiteChrome();
  const faqItems = await listPublishedFaq(supabase);

  return (
    <>
      <div data-site-content-source="fallback" hidden aria-hidden="true" />
      {jsonLd}
      <SiteShell
        settings={settings}
        headerItems={headerItems}
        footerItems={footerItems}
        overlays={overlays as Parameters<typeof SiteShell>[0]["overlays"]}
      >
        <BlockRenderer
          blocks={buildMarketplaceFallbackBlocks()}
          faqItems={faqItems.map((f) => ({
            id: String(f.id),
            question: String(f.question),
            answer_md: String(f.answer_md),
            category: f.category ? String(f.category) : undefined,
          }))}
        />
      </SiteShell>
      <SiteAnalytics />
    </>
  );
}
