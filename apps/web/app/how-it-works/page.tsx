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
  const fromCms = steps
    .map((step) => {
      if (!step || typeof step !== "object") return null;
      const row = step as Record<string, unknown>;
      const title = typeof row.title === "string" ? row.title.trim() : "";
      const body =
        typeof row.body === "string"
          ? row.body.trim()
          : typeof row.description === "string"
            ? row.description.trim()
            : undefined;
      if (!title) return null;
      return { title, body };
    })
    .filter((step): step is { title: string; body?: string } => Boolean(step));

  return fromCms.length > 0
    ? fromCms
    : HOW_IT_WORKS_STEPS.map((step) => ({ ...step }));
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
