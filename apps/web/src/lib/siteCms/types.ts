/**
 * Corporate site CMS — published content only for public getters.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const SITE_CMS_TAG = "site-cms";
export const DEFAULT_SITE_LOCALE = "en";

export type SitePublishStatus = "draft" | "scheduled" | "published" | "archived";

export type SiteSettingsPayload = {
  brand_name?: string;
  slogan?: string;
  tagline?: string;
  support_email?: string;
  support_phone?: string;
  support_phone_tel?: string;
  address?: string;
  logo_url?: string;
  hero_image_url?: string;
  store_links?: { ios?: string; android?: string; web_app?: string };
  cta_links?: {
    driver?: string;
    restaurant?: string;
    marketplace?: string;
    business?: string;
  };
  socials?: Record<string, string>;
  seo?: Record<string, string>;
  footer_blurb?: string;
  qr_urls?: Record<string, string>;
};

export type SiteSeoFields = {
  title?: string;
  description?: string;
  canonical?: string;
  robots?: string;
  og_title?: string;
  og_description?: string;
  og_image?: string;
  twitter_title?: string;
  twitter_description?: string;
  twitter_image?: string;
  json_ld?: unknown;
};

export type SitePageRow = {
  id: string;
  locale: string;
  slug: string;
  title: string;
  kind: string;
  template: string;
  status: SitePublishStatus;
  published_at: string | null;
  scheduled_for: string | null;
  seo: SiteSeoFields;
};

export type SiteBlockRow = {
  id: string;
  page_id: string;
  block_type: string;
  sort_order: number;
  visible: boolean;
  status: SitePublishStatus;
  published_at: string | null;
  scheduled_for: string | null;
  payload: Record<string, unknown>;
};

export type SiteMenuItem = {
  id: string;
  label: string;
  href: string;
  target: string;
  sort_order: number;
};

export const BLOCK_TYPES = [
  "hero",
  "features",
  "cards",
  "gallery",
  "timeline",
  "testimonials",
  "faq",
  "cta",
  "pricing",
  "contact",
  "statistics",
  "services",
  "rich_text",
  "video",
  "partners",
  "blog_teaser",
  "how_it_works",
  "mission_vision_values",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export function isPublishedNow(row: {
  status: string;
  published_at?: string | null;
  scheduled_for?: string | null;
}): boolean {
  if (row.status !== "published") return false;
  const now = Date.now();
  if (row.published_at) {
    const t = Date.parse(row.published_at);
    if (Number.isFinite(t) && t > now) return false;
  }
  if (row.scheduled_for) {
    const t = Date.parse(row.scheduled_for);
    if (Number.isFinite(t) && t > now) return false;
  }
  return true;
}

export async function getSiteSettings(
  supabase: SupabaseClient,
  locale = DEFAULT_SITE_LOCALE,
): Promise<SiteSettingsPayload> {
  const { data } = await supabase
    .from("site_settings")
    .select("payload")
    .eq("locale", locale)
    .maybeSingle();
  return ((data?.payload as SiteSettingsPayload) ?? {}) as SiteSettingsPayload;
}

export async function getMenuItems(
  supabase: SupabaseClient,
  key: "header" | "footer",
  locale = DEFAULT_SITE_LOCALE,
): Promise<SiteMenuItem[]> {
  const { data: menu } = await supabase
    .from("site_menus")
    .select("id")
    .eq("locale", locale)
    .eq("key", key)
    .maybeSingle();
  if (!menu?.id) return [];
  const { data } = await supabase
    .from("site_menu_items")
    .select("id,label,href,target,sort_order,visible")
    .eq("menu_id", menu.id)
    .eq("visible", true)
    .order("sort_order", { ascending: true });
  return (data ?? []).map((row) => ({
    id: String(row.id),
    label: String(row.label),
    href: String(row.href),
    target: String(row.target ?? "_self"),
    sort_order: Number(row.sort_order ?? 0),
  }));
}

export async function getPublishedPageBySlug(
  supabase: SupabaseClient,
  slug: string,
  locale = DEFAULT_SITE_LOCALE,
): Promise<{ page: SitePageRow; blocks: SiteBlockRow[] } | null> {
  const { data: page } = await supabase
    .from("site_pages")
    .select("*")
    .eq("locale", locale)
    .eq("slug", slug)
    .maybeSingle();
  if (!page || !isPublishedNow(page as SitePageRow)) return null;

  const { data: blocks } = await supabase
    .from("site_page_blocks")
    .select("*")
    .eq("page_id", page.id)
    .eq("visible", true)
    .order("sort_order", { ascending: true });

  const publishedBlocks = (blocks ?? []).filter((b) =>
    isPublishedNow(b as SiteBlockRow),
  ) as SiteBlockRow[];

  return {
    page: page as SitePageRow,
    blocks: publishedBlocks,
  };
}

export async function listPublishedFaq(
  supabase: SupabaseClient,
  locale = DEFAULT_SITE_LOCALE,
) {
  const { data } = await supabase
    .from("site_faq_items")
    .select("id,category,question,answer_md,sort_order")
    .eq("locale", locale)
    .eq("visible", true)
    .order("sort_order", { ascending: true });
  return data ?? [];
}

export async function listPublishedPosts(
  supabase: SupabaseClient,
  params: {
    locale?: string;
    postType?: string;
    limit?: number;
  } = {},
) {
  const locale = params.locale ?? DEFAULT_SITE_LOCALE;
  const limit = Math.min(50, Math.max(1, params.limit ?? 10));
  let q = supabase
    .from("site_posts")
    .select(
      "id,locale,post_type,slug,title,excerpt,cover_media_id,author_name,categories,tags,published_at,seo",
    )
    .eq("locale", locale)
    .eq("status", "published")
    .order("published_at", { ascending: false })
    .limit(limit);
  if (params.postType) q = q.eq("post_type", params.postType);
  const { data } = await q;
  return (data ?? []).filter((p) =>
    isPublishedNow({
      status: "published",
      published_at: p.published_at as string | null,
    }),
  );
}

export async function getPublishedPost(
  supabase: SupabaseClient,
  slug: string,
  locale = DEFAULT_SITE_LOCALE,
) {
  const { data } = await supabase
    .from("site_posts")
    .select("*")
    .eq("locale", locale)
    .eq("slug", slug)
    .eq("status", "published")
    .maybeSingle();
  if (!data || !isPublishedNow(data as { status: string; published_at: string | null })) {
    return null;
  }
  return data;
}

export async function listActiveOverlays(
  supabase: SupabaseClient,
  locale = DEFAULT_SITE_LOCALE,
) {
  const { data } = await supabase
    .from("site_overlays")
    .select("*")
    .eq("locale", locale)
    .eq("status", "published")
    .order("sort_order", { ascending: true });
  const now = Date.now();
  return (data ?? []).filter((row) => {
    if (!isPublishedNow(row as { status: string; published_at: string | null })) {
      return false;
    }
    if (row.expires_at) {
      const t = Date.parse(String(row.expires_at));
      if (Number.isFinite(t) && t < now) return false;
    }
    return true;
  });
}

export async function searchPublishedContent(
  supabase: SupabaseClient,
  query: string,
  locale = DEFAULT_SITE_LOCALE,
) {
  const q = query.trim().slice(0, 120);
  if (q.length < 2) return { pages: [], posts: [], faq: [] };

  const pattern = `%${q}%`;
  const [pages, posts, faq] = await Promise.all([
    supabase
      .from("site_pages")
      .select("slug,title,status,published_at")
      .eq("locale", locale)
      .eq("status", "published")
      .or(`title.ilike.${pattern},slug.ilike.${pattern}`)
      .limit(20),
    supabase
      .from("site_posts")
      .select("slug,title,post_type,excerpt,status,published_at")
      .eq("locale", locale)
      .eq("status", "published")
      .or(`title.ilike.${pattern},excerpt.ilike.${pattern}`)
      .limit(20),
    supabase
      .from("site_faq_items")
      .select("id,question,answer_md")
      .eq("locale", locale)
      .eq("visible", true)
      .or(`question.ilike.${pattern},answer_md.ilike.${pattern}`)
      .limit(20),
  ]);

  return {
    pages: (pages.data ?? []).filter((p) =>
      isPublishedNow({ status: "published", published_at: p.published_at }),
    ),
    posts: (posts.data ?? []).filter((p) =>
      isPublishedNow({ status: "published", published_at: p.published_at }),
    ),
    faq: faq.data ?? [],
  };
}

export async function saveRevision(
  supabase: SupabaseClient,
  input: {
    entityType: string;
    entityId: string;
    locale?: string | null;
    snapshot: unknown;
    userId?: string | null;
  },
) {
  await supabase.from("site_revisions").insert({
    entity_type: input.entityType,
    entity_id: input.entityId,
    locale: input.locale ?? null,
    snapshot: input.snapshot as object,
    created_by: input.userId ?? null,
  });
}

export async function promoteScheduledContent(supabase: SupabaseClient) {
  const nowIso = new Date().toISOString();
  const tables = ["site_pages", "site_page_blocks", "site_posts", "site_overlays"] as const;
  let promoted = 0;
  for (const table of tables) {
    const { data } = await supabase
      .from(table)
      .update({
        status: "published",
        published_at: nowIso,
      })
      .eq("status", "scheduled")
      .lte("scheduled_for", nowIso)
      .select("id");
    promoted += data?.length ?? 0;
  }
  return { promoted };
}
