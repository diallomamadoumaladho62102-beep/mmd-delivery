import { NextRequest } from "next/server";
import { assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { DEFAULT_SITE_LOCALE } from "@/lib/siteCms";
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
} from "../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("marketing.read", request);
    const supabase = buildSupabaseAdminClient();
    const { data, error } = await supabase
      .from("site_overlays")
      .select("*")
      .eq("locale", DEFAULT_SITE_LOCALE)
      .order("sort_order", { ascending: true });
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, overlays: data ?? [] });
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
    const status = cleanStatus(body.status) ?? "draft";
    const now = new Date().toISOString();
    const row = {
      locale: DEFAULT_SITE_LOCALE,
      kind: cleanText(body.kind, 40) ?? "banner",
      title: cleanText(body.title, 200),
      body: cleanText(body.body, 5000),
      cta_label: cleanText(body.cta_label, 80),
      cta_href: cleanText(body.cta_href, 500),
      placement: cleanText(body.placement, 40) ?? "top",
      dismissible: cleanBool(body.dismissible, true),
      sort_order: cleanInt(body.sort_order, 0),
      status,
      published_at: status === "published" ? now : cleanDate(body.published_at),
      scheduled_for: cleanDate(body.scheduled_for),
      expires_at: cleanDate(body.expires_at),
      payload: asObject(body.payload),
      updated_at: now,
    };
    const { data, error } = await supabase
      .from("site_overlays")
      .insert(row)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    revalidateIfPublished(status);
    return json({ ok: true, overlay: data });
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
    for (const key of [
      "kind",
      "title",
      "body",
      "cta_label",
      "cta_href",
      "placement",
    ] as const) {
      if (body[key] !== undefined) {
        patch[key] = cleanText(body[key], key === "body" ? 5000 : 500);
      }
    }
    if (body.dismissible !== undefined) {
      patch.dismissible = cleanBool(body.dismissible, true);
    }
    if (body.sort_order !== undefined) patch.sort_order = cleanInt(body.sort_order, 0);
    if (body.payload !== undefined) patch.payload = asObject(body.payload);
    if (body.scheduled_for !== undefined) {
      patch.scheduled_for = cleanDate(body.scheduled_for);
    }
    if (body.expires_at !== undefined) patch.expires_at = cleanDate(body.expires_at);
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
      .from("site_overlays")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!data) return json({ ok: false, error: "not found" }, 404);
    revalidateIfPublished(patch.status ?? data.status);
    return json({ ok: true, overlay: data });
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

    const { data: existing } = await supabase
      .from("site_overlays")
      .select("status")
      .eq("id", id)
      .maybeSingle();

    const { error } = await supabase.from("site_overlays").delete().eq("id", id);
    if (error) return json({ ok: false, error: error.message }, 500);
    if (existing?.status === "published") revalidateSiteCms();
    return json({ ok: true });
  } catch (e) {
    return adminError(e);
  }
}
