import { NextRequest } from "next/server";
import { assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  adminError,
  asObject,
  cleanBool,
  cleanDate,
  cleanStatus,
  json,
  revalidateIfPublished,
  revalidateSiteCms,
} from "../../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, ctx: Ctx) {
  try {
    await assertStaffPermission("marketing.manage", request);
    const { id } = await ctx.params;
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.payload !== undefined) patch.payload = asObject(body.payload);
    if (body.visible !== undefined) patch.visible = cleanBool(body.visible, true);
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
      if (status === "published" && body.published_at === undefined) {
        patch.published_at = new Date().toISOString();
      }
    }

    const { data, error } = await supabase
      .from("site_page_blocks")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!data) return json({ ok: false, error: "not found" }, 404);
    revalidateIfPublished(patch.status ?? data.status);
    return json({ ok: true, block: data });
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
      .from("site_page_blocks")
      .select("status")
      .eq("id", id)
      .maybeSingle();

    const { error } = await supabase
      .from("site_page_blocks")
      .delete()
      .eq("id", id);
    if (error) return json({ ok: false, error: error.message }, 500);
    if (existing?.status === "published") revalidateSiteCms();
    return json({ ok: true });
  } catch (e) {
    return adminError(e);
  }
}
