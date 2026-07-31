import { NextRequest } from "next/server";
import { assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { DEFAULT_SITE_LOCALE } from "@/lib/siteCms";
import {
  adminError,
  asObject,
  cleanDate,
  cleanStatus,
  cleanStringArray,
  cleanText,
  json,
  revalidateIfPublished,
} from "../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("marketing.read", request);
    const supabase = buildSupabaseAdminClient();
    const params = request.nextUrl.searchParams;
    const postType = cleanText(params.get("post_type"), 40);
    const status = cleanStatus(params.get("status"));
    const limit = Math.min(
      200,
      Math.max(1, Number(params.get("limit") ?? 100) || 100),
    );

    let query = supabase
      .from("site_posts")
      .select(
        "id,locale,post_type,slug,title,excerpt,cover_media_id,author_name,categories,tags,status,published_at,scheduled_for,updated_at,created_at",
      )
      .eq("locale", DEFAULT_SITE_LOCALE)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (postType) query = query.eq("post_type", postType);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, posts: data ?? [] });
  } catch (e) {
    return adminError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("marketing.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const slug = cleanText(body.slug, 120);
    const title = cleanText(body.title, 200);
    if (!slug || !title) {
      return json({ ok: false, error: "slug and title required" }, 400);
    }

    const status = cleanStatus(body.status) ?? "draft";
    const now = new Date().toISOString();
    const row = {
      locale: DEFAULT_SITE_LOCALE,
      post_type: cleanText(body.post_type, 40) ?? "blog",
      slug,
      title,
      excerpt: cleanText(body.excerpt, 1000),
      body_md: typeof body.body_md === "string" ? body.body_md.slice(0, 200_000) : "",
      cover_media_id: cleanText(body.cover_media_id, 80),
      author_name: cleanText(body.author_name, 120),
      categories: cleanStringArray(body.categories),
      tags: cleanStringArray(body.tags),
      status,
      published_at:
        status === "published" ? now : cleanDate(body.published_at),
      scheduled_for: cleanDate(body.scheduled_for),
      seo: asObject(body.seo),
      updated_at: now,
      updated_by: session.userId,
    };

    const { data, error } = await supabase
      .from("site_posts")
      .insert(row)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    revalidateIfPublished(status);
    return json({ ok: true, post: data });
  } catch (e) {
    return adminError(e);
  }
}
