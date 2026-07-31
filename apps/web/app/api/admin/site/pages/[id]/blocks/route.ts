import { NextRequest } from "next/server";
import { assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { BLOCK_TYPES } from "@/lib/siteCms";
import {
  adminError,
  asObject,
  cleanBool,
  cleanDate,
  cleanInt,
  cleanStatus,
  cleanText,
  json,
  revalidateIfPublished,
  revalidateSiteCms,
} from "../../../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, ctx: Ctx) {
  try {
    await assertStaffPermission("marketing.read", request);
    const { id } = await ctx.params;
    const supabase = buildSupabaseAdminClient();
    const { data, error } = await supabase
      .from("site_page_blocks")
      .select("*")
      .eq("page_id", id)
      .order("sort_order", { ascending: true });
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, blocks: data ?? [] });
  } catch (e) {
    return adminError(e);
  }
}

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    await assertStaffPermission("marketing.manage", request);
    const { id: pageId } = await ctx.params;
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    const blockType = cleanText(body.block_type, 64);
    if (!blockType || !(BLOCK_TYPES as readonly string[]).includes(blockType)) {
      return json({ ok: false, error: "invalid block_type" }, 400);
    }

    const { data: last } = await supabase
      .from("site_page_blocks")
      .select("sort_order")
      .eq("page_id", pageId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();

    const status = cleanStatus(body.status) ?? "published";
    const now = new Date().toISOString();
    const row = {
      page_id: pageId,
      block_type: blockType,
      sort_order:
        body.sort_order !== undefined
          ? cleanInt(body.sort_order, 0)
          : cleanInt(last?.sort_order, 0) + 10,
      visible: cleanBool(body.visible, true),
      status,
      published_at: status === "published" ? now : cleanDate(body.published_at),
      scheduled_for: cleanDate(body.scheduled_for),
      payload: asObject(body.payload),
      updated_at: now,
    };

    const { data, error } = await supabase
      .from("site_page_blocks")
      .insert(row)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    revalidateIfPublished(status);
    return json({ ok: true, block: data });
  } catch (e) {
    return adminError(e);
  }
}

export async function PUT(request: NextRequest, ctx: Ctx) {
  try {
    await assertStaffPermission("marketing.manage", request);
    const { id: pageId } = await ctx.params;
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const orderedIds = Array.isArray(body.ordered_ids)
      ? body.ordered_ids
          .map((v) => cleanText(v, 80))
          .filter((v): v is string => Boolean(v))
      : null;
    if (!orderedIds || orderedIds.length === 0) {
      return json({ ok: false, error: "ordered_ids required" }, 400);
    }

    const now = new Date().toISOString();
    for (let i = 0; i < orderedIds.length; i++) {
      const { error } = await supabase
        .from("site_page_blocks")
        .update({ sort_order: (i + 1) * 10, updated_at: now })
        .eq("id", orderedIds[i])
        .eq("page_id", pageId);
      if (error) return json({ ok: false, error: error.message }, 500);
    }

    const { data } = await supabase
      .from("site_page_blocks")
      .select("*")
      .eq("page_id", pageId)
      .order("sort_order", { ascending: true });

    revalidateSiteCms();
    return json({ ok: true, blocks: data ?? [] });
  } catch (e) {
    return adminError(e);
  }
}
