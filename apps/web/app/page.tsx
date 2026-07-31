import type { Metadata } from "next";
import BlockRenderer from "@/components/site/BlockRenderer";
import SiteAnalytics from "@/components/site/SiteAnalytics";
import SiteShell from "@/components/site/SiteShell";
import {
  buildPageMetadata,
  FallbackHome,
  loadSiteChrome,
} from "@/components/site/renderCmsPage";
import {
  getPublishedPageBySlug,
  listPublishedFaq,
  listPublishedPosts,
} from "@/lib/siteCms";
import { siteTheme } from "@/components/site/siteTheme";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  try {
    const { supabase, settings } = await loadSiteChrome();
    const home = await getPublishedPageBySlug(supabase, "home");
    return buildPageMetadata(home?.page.seo, settings, siteTheme.brandName, "/");
  } catch {
    return { title: siteTheme.brandName };
  }
}

export default async function HomePage() {
  let chrome: Awaited<ReturnType<typeof loadSiteChrome>>;
  try {
    chrome = await loadSiteChrome();
  } catch {
    return (
      <>
        <SiteShell settings={{}} headerItems={[]} footerItems={[]}>
          <FallbackHome settings={{}} />
        </SiteShell>
        <SiteAnalytics />
      </>
    );
  }

  const { supabase, settings, headerItems, footerItems, overlays } = chrome;

  let home: Awaited<ReturnType<typeof getPublishedPageBySlug>> = null;
  try {
    home = await getPublishedPageBySlug(supabase, "home");
  } catch {
    home = null;
  }

  if (!home) {
    return (
      <>
        <SiteShell
          settings={settings}
          headerItems={headerItems}
          footerItems={footerItems}
          overlays={overlays as Parameters<typeof SiteShell>[0]["overlays"]}
        >
          <FallbackHome settings={settings} />
        </SiteShell>
        <SiteAnalytics />
      </>
    );
  }

  const [faqItems, posts] = await Promise.all([
    listPublishedFaq(supabase),
    listPublishedPosts(supabase, { limit: 3, postType: "blog" }),
  ]);

  return (
    <>
      <SiteShell
        settings={settings}
        headerItems={headerItems}
        footerItems={footerItems}
        overlays={overlays as Parameters<typeof SiteShell>[0]["overlays"]}
      >
        <BlockRenderer
          blocks={home.blocks}
          faqItems={faqItems.map((f) => ({
            id: String(f.id),
            question: String(f.question),
            answer_md: String(f.answer_md),
            category: f.category ? String(f.category) : undefined,
          }))}
          posts={posts.map((p) => ({
            id: String(p.id),
            slug: String(p.slug),
            title: String(p.title),
            excerpt: (p.excerpt as string | null) ?? null,
            published_at: (p.published_at as string | null) ?? null,
            post_type: (p.post_type as string | null) ?? null,
          }))}
        />
      </SiteShell>
      <SiteAnalytics />
    </>
  );
}
