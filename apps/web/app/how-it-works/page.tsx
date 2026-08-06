import type { Metadata } from "next";
import BlockRenderer from "@/components/site/BlockRenderer";
import HowToJsonLd from "@/components/site/HowToJsonLd";
import SiteAnalytics from "@/components/site/SiteAnalytics";
import SiteShell from "@/components/site/SiteShell";
import {
  HOW_IT_WORKS_SEO,
  HOW_IT_WORKS_STEPS,
  buildHowItWorksFallbackBlocks,
} from "@/components/site/howItWorksContent";
import {
  cmsPageMetadata,
  loadSiteChrome,
  renderCmsPage,
} from "@/components/site/renderCmsPage";
import {
  getPublishedPageBySlug,
  listPublishedFaq,
} from "@/lib/siteCms";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  try {
    const meta = await cmsPageMetadata("how-it-works", "How it works");
    return {
      ...meta,
      title: meta.title || HOW_IT_WORKS_SEO.title,
      description: meta.description || HOW_IT_WORKS_SEO.description,
    };
  } catch {
    return {
      title: HOW_IT_WORKS_SEO.title,
      description: HOW_IT_WORKS_SEO.description,
      robots: HOW_IT_WORKS_SEO.robots,
    };
  }
}

function readHowToSteps(payload: Record<string, unknown> | undefined) {
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
    : HOW_IT_WORKS_STEPS.map((step) => ({
        title: step.title,
        body: step.body,
      }));
}

export default async function Page() {
  const supabase = buildSupabaseAdminClient();
  const pageData = await getPublishedPageBySlug(supabase, "how-it-works");
  const hasStructuredSteps = Boolean(
    pageData?.blocks.some((block) => block.block_type === "how_it_works"),
  );

  const howBlock = pageData?.blocks.find((block) => block.block_type === "how_it_works");
  const payload =
    howBlock?.payload && typeof howBlock.payload === "object"
      ? (howBlock.payload as Record<string, unknown>)
      : undefined;
  const steps = readHowToSteps(payload);

  const jsonLd = (
    <HowToJsonLd
      name="How MMD Delivery works"
      description={HOW_IT_WORKS_SEO.description}
      steps={steps}
    />
  );

  if (hasStructuredSteps) {
    return (
      <>
        {/* data-site-content-source lets ops verify CMS path vs code fallback */}
        <div data-site-content-source="cms" hidden aria-hidden="true" />
        {jsonLd}
        {await renderCmsPage("how-it-works")}
      </>
    );
  }

  // Definitive composition before/without CMS migration applied.
  const { settings, headerItems, footerItems, overlays } = await loadSiteChrome();
  const faqItems = await listPublishedFaq(supabase);
  const blocks = buildHowItWorksFallbackBlocks();

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
          blocks={blocks}
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
