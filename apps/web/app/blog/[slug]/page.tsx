import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SiteAnalytics from "@/components/site/SiteAnalytics";
import SiteShell from "@/components/site/SiteShell";
import { renderSimpleMarkdown } from "@/components/site/simpleMarkdown";
import {
  buildPageMetadata,
  loadSiteChrome,
} from "@/components/site/renderCmsPage";
import { getPublishedPost, type SiteSeoFields } from "@/lib/siteCms";
import {
  siteContainerClass,
  siteHeadingClass,
  siteSectionClass,
} from "@/components/site/siteTheme";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const { supabase, settings } = await loadSiteChrome();
    const post = await getPublishedPost(supabase, slug);
    if (!post) return { title: "Post not found" };
    const seo = (post.seo ?? {}) as SiteSeoFields;
    return buildPageMetadata(
      {
        ...seo,
        title: seo.title || String(post.title),
        description: seo.description || String(post.excerpt ?? ""),
      },
      settings,
      String(post.title),
    );
  } catch {
    return { title: "Blog" };
  }
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const { supabase, settings, headerItems, footerItems, overlays } =
    await loadSiteChrome();
  const post = await getPublishedPost(supabase, slug);
  if (!post) notFound();

  return (
    <>
      <SiteShell
        settings={settings}
        headerItems={headerItems}
        footerItems={footerItems}
        overlays={overlays as Parameters<typeof SiteShell>[0]["overlays"]}
      >
        <article className={siteSectionClass}>
          <div className={`${siteContainerClass} max-w-3xl`}>
            <p className="text-sm text-slate-500">
              {post.published_at
                ? new Date(String(post.published_at)).toLocaleDateString()
                : null}
              {post.author_name ? ` · ${String(post.author_name)}` : null}
            </p>
            <h1 className={`${siteHeadingClass} mt-2`}>{String(post.title)}</h1>
            {post.excerpt ? (
              <p className="mt-4 text-lg text-slate-300">{String(post.excerpt)}</p>
            ) : null}
            <div className="mt-8">
              {renderSimpleMarkdown(String(post.body_md ?? ""))}
            </div>
          </div>
        </article>
      </SiteShell>
      <SiteAnalytics />
    </>
  );
}
