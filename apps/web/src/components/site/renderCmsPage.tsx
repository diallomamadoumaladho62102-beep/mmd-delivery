import type { Metadata } from "next";
import { notFound } from "next/navigation";
import BlockRenderer from "@/components/site/BlockRenderer";
import HeroShowcase from "@/components/site/HeroShowcase";
import SiteAnalytics from "@/components/site/SiteAnalytics";
import SiteImage from "@/components/site/SiteImage";
import SiteShell from "@/components/site/SiteShell";
import {
  getMenuItems,
  getPublishedPageBySlug,
  getSiteSettings,
  listActiveOverlays,
  listPublishedFaq,
  listPublishedPosts,
  type SiteSeoFields,
  type SiteSettingsPayload,
} from "@/lib/siteCms";
import { CANONICAL_SITE_ORIGIN } from "@/lib/productionSite";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  resolveSiteLogo,
  siteChipClass,
  siteContainerClass,
  siteGradientTextClass,
  sitePrimaryBtnClass,
  siteSecondaryBtnClass,
  siteTheme,
} from "@/components/site/siteTheme";
import Link from "next/link";

export async function loadSiteChrome() {
  const supabase = buildSupabaseAdminClient();
  const [settings, headerItems, footerItems, overlays] = await Promise.all([
    getSiteSettings(supabase),
    getMenuItems(supabase, "header"),
    getMenuItems(supabase, "footer"),
    listActiveOverlays(supabase),
  ]);
  return { supabase, settings, headerItems, footerItems, overlays };
}

export function buildPageMetadata(
  seo: SiteSeoFields | undefined,
  settings: SiteSettingsPayload,
  fallbackTitle?: string,
  path = "/",
): Metadata {
  const siteSeo = (settings.seo ?? {}) as SiteSeoFields;
  const title =
    seo?.title ||
    siteSeo.title ||
    fallbackTitle ||
    settings.brand_name ||
    siteTheme.brandName;
  const description =
    seo?.description ||
    siteSeo.description ||
    settings.tagline ||
    "Taxi, food, packages, marketplace and business tools — one modern platform.";
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const canonical =
    seo?.canonical ||
    siteSeo.canonical ||
    `${CANONICAL_SITE_ORIGIN}${normalizedPath === "/" ? "" : normalizedPath}`;
  const ogImage =
    seo?.og_image ||
    siteSeo.og_image ||
    siteTheme.ogImageSrc ||
    settings.hero_image_url;
  const robots = seo?.robots || siteSeo.robots || "index,follow";

  return {
    title,
    description,
    metadataBase: new URL(CANONICAL_SITE_ORIGIN),
    alternates: { canonical },
    robots,
    openGraph: {
      title: seo?.og_title || title,
      description: seo?.og_description || description,
      url: canonical,
      images: ogImage ? [{ url: ogImage }] : undefined,
      siteName: settings.brand_name || siteTheme.brandName,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: seo?.twitter_title || title,
      description: seo?.twitter_description || description,
      images:
        seo?.twitter_image || ogImage
          ? [String(seo?.twitter_image || ogImage)]
          : undefined,
    },
  };
}

/** Graceful static home when CMS home is missing — no fake stats. */
export function FallbackHome({ settings }: { settings: SiteSettingsPayload }) {
  const brand = settings.brand_name || siteTheme.brandName;
  const slogan = settings.slogan || "We Deliver With Heart";
  const tagline =
    settings.tagline ||
    "A modern platform for taxi, food, packages, marketplace shopping, and business logistics.";
  const logo = resolveSiteLogo(settings.logo_url);

  return (
    <section className="border-b border-white/5">
      <div
        className={`${siteContainerClass} grid items-center gap-12 py-16 lg:grid-cols-[1.05fr_0.95fr] lg:py-24`}
      >
        <div className="min-w-0">
          <div className="mb-6 flex items-center gap-4">
            <SiteImage
              src={logo}
              alt={`${brand} — ${slogan}`}
              width={112}
              height={72}
              className="h-[4.5rem] w-28 object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.45)]"
              priority
            />
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-orange-300">
                {brand}
              </p>
              <p className="text-slate-300">{slogan}</p>
            </div>
          </div>
          <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl lg:text-[3.4rem] lg:leading-[1.08]">
            <span className={siteGradientTextClass}>{slogan}</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-slate-200">{tagline}</p>
          <ul className="mt-7 flex flex-wrap gap-2.5" aria-label="Benefits">
            {[
              "Secure Stripe payments",
              "Live GPS tracking",
              "Smart dispatch",
              "Unified wallets",
            ].map((b) => (
              <li key={b} className={siteChipClass}>
                {b}
              </li>
            ))}
          </ul>
          <div className="mt-9 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Link href="/download" data-site-event="store_click_web" className={`${sitePrimaryBtnClass} w-full`}>
              Download the app
            </Link>
            <Link href="/contact" className={`${siteSecondaryBtnClass} w-full`}>
              Contact us
            </Link>
          </div>
        </div>
        <div className="min-w-0">
          <HeroShowcase brand={brand} />
        </div>
      </div>
    </section>
  );
}

export async function renderCmsPage(slug: string) {
  const { supabase, settings, headerItems, footerItems, overlays } =
    await loadSiteChrome();
  const pageData = await getPublishedPageBySlug(supabase, slug);
  if (!pageData) notFound();

  const needsFaq = pageData.blocks.some((b) => b.block_type === "faq");
  const needsPosts = pageData.blocks.some((b) => b.block_type === "blog_teaser");
  const [faqItems, posts] = await Promise.all([
    needsFaq ? listPublishedFaq(supabase) : Promise.resolve([]),
    needsPosts
      ? listPublishedPosts(supabase, { limit: 6, postType: "blog" })
      : Promise.resolve([]),
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
          blocks={pageData.blocks}
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

export async function cmsPageMetadata(slug: string, fallbackTitle?: string): Promise<Metadata> {
  try {
    const supabase = buildSupabaseAdminClient();
    const [settings, pageData] = await Promise.all([
      getSiteSettings(supabase),
      getPublishedPageBySlug(supabase, slug),
    ]);
    const path =
      slug === "home"
        ? "/"
        : slug === "business" || slug === "restaurants"
          ? `/p/${slug}`
          : `/${slug}`;
    return buildPageMetadata(pageData?.page.seo, settings, fallbackTitle, path);
  } catch {
    return {
      title: fallbackTitle || siteTheme.brandName,
      metadataBase: new URL(CANONICAL_SITE_ORIGIN),
    };
  }
}
