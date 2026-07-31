import { NextRequest } from "next/server";
import { assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { saveRevision } from "@/lib/siteCms";
import {
  adminError,
  asObject,
  cleanDate,
  cleanStatus,
  cleanText,
  json,
  revalidateIfPublished,
  revalidateSiteCms,
} from "../../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  try {
    await assertStaffPermission("marketing.read", request);
    const { id } = await ctx.params;
    const supabase = buildSupabaseAdminClient();
    const { data: page, error } = await supabase
      .from("site_pages")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!page) return json({ ok: false, error: "not found" }, 404);

    const { data: blocks } = await supabase
      .from("site_page_blocks")
      .select("*")
      .eq("page_id", id)
      .order("sort_order", { ascending: true });

    return json({ ok: true, page, blocks: blocks ?? [] });
  } catch (e) {
    return adminError(e);
  }
}

export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    const session = await assertStaffPermission("marketing.manage", request);
    const { id } = await ctx.params;
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const { data: existing, error: loadErr } = await supabase
      .from("site_pages")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (loadErr) return json({ ok: false, error: loadErr.message }, 500);
    if (!existing) return json({ ok: false, error: "not found" }, 404);

    await saveRevision(supabase, {
      entityType: "site_page",
      entityId: id,
      locale: existing.locale as string,
      snapshot: existing,
      userId: session.userId,
    });

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
      updated_by: session.userId,
    };
    if (body.slug !== undefined) {
      const slug = cleanText(body.slug, 120);
      if (!slug) return json({ ok: false, error: "slug required" }, 400);
      patch.slug = slug;
    }
    if (body.title !== undefined) {
      const title = cleanText(body.title, 200);
      if (!title) return json({ ok: false, error: "title required" }, 400);
      patch.title = title;
    }
    if (body.kind !== undefined) patch.kind = cleanText(body.kind, 40) ?? existing.kind;
    if (body.template !== undefined) {
      patch.template = cleanText(body.template, 40) ?? existing.template;
    }
    if (body.seo !== undefined) patch.seo = asObject(body.seo);
    if (body.scheduled_for !== undefined) {
      patch.scheduled_for = cleanDate(body.scheduled_for);
    }
    if (body.published_at !== undefined) {
      patch.published_at = cleanDate(body.published_at);
    }
    if (body.status !== undefined) {
      const status = cleanStatus(body.status);
      if (!status) return json({ ok: false, error: "invalid status" }, 400);
      patch.status = status;
      if (status === "published" && !patch.published_at && !existing.published_at) {
        patch.published_at = new Date().toISOString();
      }
    }

    const { data, error } = await supabase
      .from("site_pages")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    revalidateIfPublished(patch.status ?? existing.status);
    return json({ ok: true, page: data });
  } catch (e) {
    return adminError(e);
  }
}

export async function DELETE(request: NextRequest, ctx: Ctx) {
  try {
    await assertStaffPermission("marketing.manage", request);
    const { id } = await ctx.params;
    const supabase = buildSupabaseAdminClient();

    const { data: existing } = await supabase
      .from("site_pages")
      .select("status")
      .eq("id", id)
      .maybeSingle();

    const { error } = await supabase.from("site_pages").delete().eq("id", id);
    if (error) return json({ ok: false, error: error.message }, 500);
    if (existing?.status === "published") revalidateSiteCms();
    return json({ ok: true });
  } catch (e) {
    return adminError(e);
  }
}
