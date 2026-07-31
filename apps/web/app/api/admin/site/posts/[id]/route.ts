import { NextRequest } from "next/server";
import { assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { saveRevision } from "@/lib/siteCms";
import {
  adminError,
  asObject,
  cleanDate,
  cleanStatus,
  cleanStringArray,
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
    const { data, error } = await supabase
      .from("site_posts")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!data) return json({ ok: false, error: "not found" }, 404);
    return json({ ok: true, post: data });
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
      .from("site_posts")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (loadErr) return json({ ok: false, error: loadErr.message }, 500);
    if (!existing) return json({ ok: false, error: "not found" }, 404);

    await saveRevision(supabase, {
      entityType: "site_post",
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
    if (body.post_type !== undefined) {
      patch.post_type = cleanText(body.post_type, 40) ?? existing.post_type;
    }
    if (body.excerpt !== undefined) patch.excerpt = cleanText(body.excerpt, 1000);
    if (body.body_md !== undefined) {
      patch.body_md =
        typeof body.body_md === "string" ? body.body_md.slice(0, 200_000) : "";
    }
    if (body.cover_media_id !== undefined) {
      patch.cover_media_id = cleanText(body.cover_media_id, 80);
    }
    if (body.author_name !== undefined) {
      patch.author_name = cleanText(body.author_name, 120);
    }
    if (body.categories !== undefined) {
      patch.categories = cleanStringArray(body.categories);
    }
    if (body.tags !== undefined) patch.tags = cleanStringArray(body.tags);
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
      .from("site_posts")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    revalidateIfPublished(patch.status ?? existing.status);
    return json({ ok: true, post: data });
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
      .from("site_posts")
      .select("status")
      .eq("id", id)
      .maybeSingle();

    const { error } = await supabase.from("site_posts").delete().eq("id", id);
    if (error) return json({ ok: false, error: error.message }, 500);
    if (existing?.status === "published") revalidateSiteCms();
    return json({ ok: true });
  } catch (e) {
    return adminError(e);
  }
}
