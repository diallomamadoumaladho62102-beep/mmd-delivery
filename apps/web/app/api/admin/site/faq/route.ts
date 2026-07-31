import { NextRequest } from "next/server";
import { assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { DEFAULT_SITE_LOCALE } from "@/lib/siteCms";
import {
  adminError,
  cleanBool,
  cleanInt,
  cleanText,
  json,
  revalidateSiteCms,
} from "../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("marketing.read", request);
    const supabase = buildSupabaseAdminClient();
    const { data, error } = await supabase
      .from("site_faq_items")
      .select("*")
      .eq("locale", DEFAULT_SITE_LOCALE)
      .order("sort_order", { ascending: true });
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, items: data ?? [] });
  } catch (e) {
    return adminError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    await assertStaffPermission("marketing.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const question = cleanText(body.question, 500);
    const answerMd =
      typeof body.answer_md === "string" ? body.answer_md.slice(0, 20_000) : "";
    if (!question || !answerMd) {
      return json({ ok: false, error: "question and answer_md required" }, 400);
    }
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("site_faq_items")
      .insert({
        locale: DEFAULT_SITE_LOCALE,
        category: cleanText(body.category, 80) ?? "general",
        question,
        answer_md: answerMd,
        sort_order: cleanInt(body.sort_order, 0),
        visible: cleanBool(body.visible, true),
        updated_at: now,
      })
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    revalidateSiteCms();
    return json({ ok: true, item: data });
  } catch (e) {
    return adminError(e);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    await assertStaffPermission("marketing.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const id = cleanText(body.id, 80);
    if (!id) return json({ ok: false, error: "id required" }, 400);

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.category !== undefined) {
      patch.category = cleanText(body.category, 80) ?? "general";
    }
    if (body.question !== undefined) {
      const question = cleanText(body.question, 500);
      if (!question) return json({ ok: false, error: "question required" }, 400);
      patch.question = question;
    }
    if (body.answer_md !== undefined) {
      patch.answer_md =
        typeof body.answer_md === "string" ? body.answer_md.slice(0, 20_000) : "";
    }
    if (body.sort_order !== undefined) patch.sort_order = cleanInt(body.sort_order, 0);
    if (body.visible !== undefined) patch.visible = cleanBool(body.visible, true);

    const { data, error } = await supabase
      .from("site_faq_items")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!data) return json({ ok: false, error: "not found" }, 404);
    revalidateSiteCms();
    return json({ ok: true, item: data });
  } catch (e) {
    return adminError(e);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await assertStaffPermission("marketing.manage", request);
    const supabase = buildSupabaseAdminClient();
    const id =
      cleanText(request.nextUrl.searchParams.get("id"), 80) ||
      cleanText(
        ((await request.json().catch(() => ({}))) as Record<string, unknown>).id,
        80,
      );
    if (!id) return json({ ok: false, error: "id required" }, 400);
    const { error } = await supabase.from("site_faq_items").delete().eq("id", id);
    if (error) return json({ ok: false, error: error.message }, 500);
    revalidateSiteCms();
    return json({ ok: true });
  } catch (e) {
    return adminError(e);
  }
}
