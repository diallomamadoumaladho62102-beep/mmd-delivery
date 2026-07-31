import { NextRequest } from "next/server";
import { assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  adminError,
  asObject,
  cleanText,
  json,
  revalidateSiteCms,
} from "../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ENTITY_TABLE: Record<string, string> = {
  site_page: "site_pages",
  site_post: "site_posts",
  site_page_block: "site_page_blocks",
  site_settings: "site_settings",
  site_overlay: "site_overlays",
};

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("marketing.read", request);
    const supabase = buildSupabaseAdminClient();
    const params = request.nextUrl.searchParams;
    const entityType = cleanText(params.get("entity_type"), 64);
    const entityId = cleanText(params.get("entity_id"), 80);
    if (!entityType || !entityId) {
      return json(
        { ok: false, error: "entity_type and entity_id required" },
        400,
      );
    }

    const limit = Math.min(
      100,
      Math.max(1, Number(params.get("limit") ?? 30) || 30),
    );
    const { data, error } = await supabase
      .from("site_revisions")
      .select("*")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, revisions: data ?? [] });
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
    const revisionId = cleanText(body.revision_id, 80);
    if (!revisionId) {
      return json({ ok: false, error: "revision_id required" }, 400);
    }

    const { data: rev, error: loadErr } = await supabase
      .from("site_revisions")
      .select("*")
      .eq("id", revisionId)
      .maybeSingle();
    if (loadErr) return json({ ok: false, error: loadErr.message }, 500);
    if (!rev) return json({ ok: false, error: "revision not found" }, 404);

    const entityType = String(rev.entity_type);
    const entityId = String(rev.entity_id);
    const table = ENTITY_TABLE[entityType];
    if (!table) {
      return json({ ok: false, error: `unsupported entity_type ${entityType}` }, 400);
    }

    const snapshot = asObject(rev.snapshot);
    const restore: Record<string, unknown> = { ...snapshot };
    delete restore.id;
    delete restore.created_at;
    restore.updated_at = new Date().toISOString();
    if ("updated_by" in restore) restore.updated_by = session.userId;

    let result;
    if (entityType === "site_settings") {
      const locale = cleanText(snapshot.locale, 16) ?? "en";
      const { data, error } = await supabase
        .from("site_settings")
        .upsert(
          {
            locale,
            payload: asObject(snapshot.payload),
            updated_at: restore.updated_at,
            updated_by: session.userId,
          },
          { onConflict: "locale" },
        )
        .select("*")
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      result = data;
    } else {
      const { data, error } = await supabase
        .from(table)
        .update(restore)
        .eq("id", entityId)
        .select("*")
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      if (!data) return json({ ok: false, error: "entity not found" }, 404);
      result = data;
    }

    revalidateSiteCms();
    return json({ ok: true, entity_type: entityType, entity: result });
  } catch (e) {
    return adminError(e);
  }
}
