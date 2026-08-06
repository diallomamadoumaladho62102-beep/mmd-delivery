import type { Metadata } from "next";
import BlockRenderer from "@/components/site/BlockRenderer";
import SiteAnalytics from "@/components/site/SiteAnalytics";
import SiteShell from "@/components/site/SiteShell";
import {
  FAQ_SEO,
  buildFaqFallbackBlocks,
} from "@/components/site/faqContent";
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
    const meta = await cmsPageMetadata("faq", "FAQ");
    return {
      ...meta,
      title: meta.title || FAQ_SEO.title,
      description: meta.description || FAQ_SEO.description,
    };
  } catch {
    return {
      title: FAQ_SEO.title,
      description: FAQ_SEO.description,
      robots: FAQ_SEO.robots,
    };
  }
}

export default async function FaqMarketingPage() {
  const supabase = buildSupabaseAdminClient();
  const pageData = await getPublishedPageBySlug(supabase, "faq");
  const hasStructuredCms = Boolean(
    pageData?.blocks.some(
      (block) =>
        block.block_type === "hero" ||
        block.block_type === "features" ||
        block.block_type === "how_it_works" ||
        block.block_type === "contact",
    ),
  );

  const jsonLd = null;

  if (hasStructuredCms) {
    return (
      <>
        <div data-site-content-source="cms" hidden aria-hidden="true" />
        {jsonLd}
        {await renderCmsPage("faq")}
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
          blocks={buildFaqFallbackBlocks()}
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
