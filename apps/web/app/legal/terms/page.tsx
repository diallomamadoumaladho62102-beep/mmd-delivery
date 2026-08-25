import type { Metadata } from "next";
import BlockRenderer from "@/components/site/BlockRenderer";
import SiteAnalytics from "@/components/site/SiteAnalytics";
import SiteShell from "@/components/site/SiteShell";
import {
  TERMS_SEO,
  buildTermsFallbackBlocks,
} from "@/components/site/termsContent";
import { loadSiteChrome } from "@/components/site/renderCmsPage";
import { listPublishedFaq } from "@/lib/siteCms";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: TERMS_SEO.title,
    description: TERMS_SEO.description,
    robots: TERMS_SEO.robots,
  };
}

export default async function TermsMarketingPage() {
  const supabase = buildSupabaseAdminClient();
  const { settings, headerItems, footerItems, overlays } = await loadSiteChrome();
  const faqItems = await listPublishedFaq(supabase);

  return (
    <>
      <div data-site-content-source="fallback" hidden aria-hidden="true" />
      <SiteShell
        settings={settings}
        headerItems={headerItems}
        footerItems={footerItems}
        overlays={overlays as Parameters<typeof SiteShell>[0]["overlays"]}
      >
        <BlockRenderer
          blocks={buildTermsFallbackBlocks()}
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
