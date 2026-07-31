import type { Metadata } from "next";
import Link from "next/link";
import SiteAnalytics from "@/components/site/SiteAnalytics";
import SiteShell from "@/components/site/SiteShell";
import {
  buildPageMetadata,
  loadSiteChrome,
} from "@/components/site/renderCmsPage";
import { listPublishedPosts } from "@/lib/siteCms";
import {
  siteCardClass,
  siteContainerClass,
  siteHeadingClass,
  siteSectionClass,
} from "@/components/site/siteTheme";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  try {
    const { settings } = await loadSiteChrome();
    return buildPageMetadata(
      { title: "Blog — MMD Delivery", description: "News and updates from MMD Delivery." },
      settings,
      "Blog",
    );
  } catch {
    return { title: "Blog — MMD Delivery" };
  }
}

export default async function BlogIndexPage() {
  const { settings, headerItems, footerItems, overlays, supabase } =
    await loadSiteChrome();
  const posts = await listPublishedPosts(supabase, { limit: 24, postType: "blog" });

  return (
    <>
      <SiteShell
        settings={settings}
        headerItems={headerItems}
        footerItems={footerItems}
        overlays={overlays as Parameters<typeof SiteShell>[0]["overlays"]}
      >
        <section className={siteSectionClass}>
          <div className={siteContainerClass}>
            <h1 className={siteHeadingClass}>Blog</h1>
            <p className="mt-3 max-w-2xl text-slate-300">
              News and product updates from MMD Delivery.
            </p>
            {posts.length === 0 ? (
              <p className="mt-10 text-slate-400">No posts published yet.</p>
            ) : (
              <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {posts.map((post) => (
                  <Link
                    key={String(post.id)}
                    href={`/blog/${post.slug}`}
                    className={`${siteCardClass} block`}
                  >
                    <h2 className="text-lg font-semibold text-white">{String(post.title)}</h2>
                    {post.excerpt ? (
                      <p className="mt-2 line-clamp-3 text-sm text-slate-400">
                        {String(post.excerpt)}
                      </p>
                    ) : null}
                    {post.published_at ? (
                      <p className="mt-3 text-xs text-slate-500">
                        {new Date(String(post.published_at)).toLocaleDateString()}
                      </p>
                    ) : null}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </SiteShell>
      <SiteAnalytics />
    </>
  );
}
