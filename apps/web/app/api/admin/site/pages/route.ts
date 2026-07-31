import { NextRequest } from "next/server";
import { assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { DEFAULT_SITE_LOCALE } from "@/lib/siteCms";
import {
  adminError,
  asObject,
  cleanDate,
  cleanStatus,
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
    const status = cleanStatus(params.get("status"));
    const limit = Math.min(
      200,
      Math.max(1, Number(params.get("limit") ?? 100) || 100),
    );

    let query = supabase
      .from("site_pages")
      .select(
        "id,locale,slug,title,kind,template,status,published_at,scheduled_for,seo,updated_at,created_at",
      )
      .eq("locale", DEFAULT_SITE_LOCALE)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (status) query = query.eq("status", status);

    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, pages: data ?? [] });
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
      slug,
      title,
      kind: cleanText(body.kind, 40) ?? "marketing",
      template: cleanText(body.template, 40) ?? "standard",
      status,
      published_at: status === "published" ? now : null,
      scheduled_for: cleanDate(body.scheduled_for),
      seo: asObject(body.seo),
      updated_at: now,
      updated_by: session.userId,
    };

    const { data, error } = await supabase
      .from("site_pages")
      .insert(row)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    revalidateIfPublished(status);
    return json({ ok: true, page: data });
  } catch (e) {
    return adminError(e);
  }
}
