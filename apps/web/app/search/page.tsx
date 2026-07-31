import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import SiteAnalytics from "@/components/site/SiteAnalytics";
import SiteShell from "@/components/site/SiteShell";
import {
  buildPageMetadata,
  loadSiteChrome,
} from "@/components/site/renderCmsPage";
import { searchPublishedContent } from "@/lib/siteCms";
import {
  siteContainerClass,
  siteHeadingClass,
  siteLinkClass,
  siteSectionClass,
} from "@/components/site/siteTheme";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string }> };

const APP_PORTAL_SLUGS = new Set(["business", "restaurants"]);

function pageHref(slug: string): string {
  if (slug === "home") return "/";
  if (APP_PORTAL_SLUGS.has(slug)) return `/p/${slug}`;
  return `/${slug}`;
}

export async function generateMetadata(): Promise<Metadata> {
  try {
    const { settings } = await loadSiteChrome();
    return buildPageMetadata(
      { title: "Search — MMD Delivery", robots: "noindex,follow" },
      settings,
      "Search",
      "/search",
    );
  } catch {
    return { title: "Search", robots: "noindex,follow" };
  }
}

export default async function SearchPage({ searchParams }: Props) {
  const { q: rawQ } = await searchParams;
  const q = String(rawQ ?? "").trim();
  const { supabase, settings, headerItems, footerItems, overlays } =
    await loadSiteChrome();
  const results =
    q.length >= 2
      ? await searchPublishedContent(supabase, q)
      : { pages: [], posts: [], faq: [] };

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
            <h1 className={siteHeadingClass}>Search</h1>
            <form method="get" action="/search" className="mt-6 flex max-w-xl gap-2" role="search">
              <label htmlFor="site-search-q" className="sr-only">
                Search query
              </label>
              <input
                id="site-search-q"
                name="q"
                defaultValue={q}
                placeholder="Search pages, posts, FAQ…"
                className="flex-1 rounded-xl border border-white/15 bg-slate-950/60 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-orange-400/50 focus:outline-none focus:ring-1 focus:ring-orange-400/40"
              />
              <button
                type="submit"
                className="rounded-xl bg-gradient-to-br from-amber-500 via-orange-500 to-rose-500 px-5 py-2.5 text-sm font-semibold text-white"
              >
                Search
              </button>
            </form>

            {q.length > 0 && q.length < 2 ? (
              <p className="mt-6 text-sm text-slate-400">Enter at least 2 characters.</p>
            ) : null}

            {q.length >= 2 ? (
              <div className="mt-10 space-y-10">
                <ResultGroup title="Pages">
                  {results.pages.length === 0 ? (
                    <Empty />
                  ) : (
                    <ul className="space-y-2">
                      {results.pages.map((p) => (
                        <li key={String(p.slug)}>
                          <Link href={pageHref(String(p.slug))} className={siteLinkClass}>
                            {String(p.title)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </ResultGroup>
                <ResultGroup title="Posts">
                  {results.posts.length === 0 ? (
                    <Empty />
                  ) : (
                    <ul className="space-y-2">
                      {results.posts.map((p) => (
                        <li key={String(p.slug)}>
                          <Link href={`/blog/${p.slug}`} className={siteLinkClass}>
                            {String(p.title)}
                          </Link>
                          {p.excerpt ? (
                            <p className="text-sm text-slate-500">{String(p.excerpt)}</p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </ResultGroup>
                <ResultGroup title="FAQ">
                  {results.faq.length === 0 ? (
                    <Empty />
                  ) : (
                    <ul className="space-y-3">
                      {results.faq.map((f) => (
                        <li key={String(f.id)}>
                          <Link href="/faq" className={siteLinkClass}>
                            {String(f.question)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </ResultGroup>
              </div>
            ) : null}
          </div>
        </section>
      </SiteShell>
      <SiteAnalytics />
    </>
  );
}

function ResultGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function Empty() {
  return <p className="text-sm text-slate-500">No results.</p>;
}
