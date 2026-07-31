import type { MetadataRoute } from "next";
import { CANONICAL_SITE_ORIGIN } from "@/lib/productionSite";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

const STATIC_PATHS = [
  "/",
  "/company",
  "/drivers",
  "/marketplace",
  "/how-it-works",
  "/faq",
  "/partners",
  "/careers",
  "/press",
  "/contact",
  "/blog",
  "/download",
  "/p/business",
  "/p/restaurants",
];

/** App-portal routes that should not be listed as marketing CMS pages. */
const APP_PORTAL_SLUGS = new Set(["business", "restaurants"]);

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = CANONICAL_SITE_ORIGIN;
  const now = new Date();
  const entries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: `${origin}${path}`,
    lastModified: now,
    changeFrequency: path === "/" ? "daily" : "weekly",
    priority: path === "/" ? 1 : 0.7,
  }));

  try {
    const supabase = buildSupabaseAdminClient();
    const [{ data: pages }, { data: posts }] = await Promise.all([
      supabase
        .from("site_pages")
        .select("slug,published_at,updated_at,status")
        .eq("locale", "en")
        .eq("status", "published"),
      supabase
        .from("site_posts")
        .select("slug,published_at,updated_at,status,post_type")
        .eq("locale", "en")
        .eq("status", "published")
        .eq("post_type", "blog"),
    ]);

    for (const page of pages ?? []) {
      const slug = String(page.slug);
      if (slug === "home") continue;
      const path = APP_PORTAL_SLUGS.has(slug) ? `/p/${slug}` : `/${slug}`;
      const url = `${origin}${path}`;
      if (entries.some((e) => e.url === url)) continue;
      entries.push({
        url,
        lastModified: page.updated_at
          ? new Date(String(page.updated_at))
          : page.published_at
            ? new Date(String(page.published_at))
            : now,
        changeFrequency: "weekly",
        priority: 0.6,
      });
    }

    for (const post of posts ?? []) {
      entries.push({
        url: `${origin}/blog/${post.slug}`,
        lastModified: post.updated_at
          ? new Date(String(post.updated_at))
          : post.published_at
            ? new Date(String(post.published_at))
            : now,
        changeFrequency: "monthly",
        priority: 0.5,
      });
    }
  } catch {
    /* return static sitemap if CMS unavailable */
  }

  return entries;
}
