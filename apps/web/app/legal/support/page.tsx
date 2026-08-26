import type { Metadata } from "next";
import BlockRenderer from "@/components/site/BlockRenderer";
import SiteAnalytics from "@/components/site/SiteAnalytics";
import SiteShell from "@/components/site/SiteShell";
import {
  SUPPORT_SEO,
  buildSupportFallbackBlocks,
  withSupportSmsHelpBlocks,
} from "@/components/site/supportContent";
import {
  cmsPageMetadata,
  loadSiteChrome,
} from "@/components/site/renderCmsPage";
import { getPublishedPageBySlug, listPublishedFaq } from "@/lib/siteCms";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  try {
    const meta = await cmsPageMetadata("support", "Support");
    return {
      ...meta,
      title: meta.title || SUPPORT_SEO.title,
      description: meta.description || SUPPORT_SEO.description,
    };
  } catch {
    return {
      title: SUPPORT_SEO.title,
      description: SUPPORT_SEO.description,
      robots: SUPPORT_SEO.robots,
    };
  }
}

export default async function SupportMarketingPage() {
  const supabase = buildSupabaseAdminClient();
  const pageData = await getPublishedPageBySlug(supabase, "support");
  const hasStructuredCms = Boolean(
    pageData?.blocks.some(
      (block) =>
        block.block_type === "hero" ||
        block.block_type === "features" ||
        block.block_type === "how_it_works" ||
        block.block_type === "contact",
    ),
  );

  const { settings, headerItems, footerItems, overlays } = await loadSiteChrome();
  const faqItems = await listPublishedFaq(supabase);
  const blocks = withSupportSmsHelpBlocks(
    hasStructuredCms && pageData
      ? pageData.blocks
      : buildSupportFallbackBlocks(),
  );

  return (
    <>
      <div
        data-site-content-source={hasStructuredCms ? "cms" : "fallback"}
        hidden
        aria-hidden="true"
      />
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
