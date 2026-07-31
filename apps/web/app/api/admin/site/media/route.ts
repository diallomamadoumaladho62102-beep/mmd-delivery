import { NextRequest } from "next/server";
import { assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { sniffImageMime } from "@/lib/uploadSecurity";
import {
  adminError,
  cleanStringArray,
  cleanText,
  json,
} from "../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "site-media";
const MAX_BYTES = 8 * 1024 * 1024;

function publicUrl(supabase: ReturnType<typeof buildSupabaseAdminClient>, path: string) {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("marketing.read", request);
    const supabase = buildSupabaseAdminClient();
    const params = request.nextUrl.searchParams;
    const folder = cleanText(params.get("folder"), 80);
    const q = cleanText(params.get("q"), 120);
    const tag = cleanText(params.get("tag"), 80);
    const limit = Math.min(
      200,
      Math.max(1, Number(params.get("limit") ?? 100) || 100),
    );

    let query = supabase
      .from("site_media")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (folder) query = query.eq("folder", folder);
    if (tag) query = query.contains("tags", [tag]);
    if (q) query = query.or(`filename.ilike.%${q}%,alt.ilike.%${q}%`);

    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);

    const media = (data ?? []).map((row) => ({
      ...row,
      public_url: publicUrl(supabase, String(row.storage_path)),
    }));
    return json({ ok: true, media });
  } catch (e) {
    return adminError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("marketing.manage", request);
    const supabase = buildSupabaseAdminClient();
    const contentType = request.headers.get("content-type") ?? "";

    if (!contentType.includes("multipart/form-data")) {
      return json({ ok: false, error: "multipart upload required" }, 400);
    }

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return json({ ok: false, error: "file required" }, 400);
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    if (buffer.length > MAX_BYTES) {
      return json({ ok: false, error: "file too large (max 8MB)" }, 400);
    }
    const sniffed = sniffImageMime(buffer);
    if (!sniffed) {
      return json({ ok: false, error: "invalid image content" }, 400);
    }

    const folder = cleanText(form.get("folder"), 80) ?? "general";
    const alt = cleanText(form.get("alt"), 300);
    const tagsRaw = form.get("tags");
    const tags =
      typeof tagsRaw === "string"
        ? tagsRaw
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 40)
        : [];

    const safeName = (file.name || "image")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .slice(0, 80);
    const ext = sniffed.ext === "jpeg" ? "jpg" : sniffed.ext;
    const storagePath = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: sniffed.mime,
        upsert: false,
      });
    if (upErr) return json({ ok: false, error: upErr.message }, 500);

    const { data, error } = await supabase
      .from("site_media")
      .insert({
        folder,
        filename: safeName || `image.${ext}`,
        storage_path: storagePath,
        alt,
        mime: sniffed.mime,
        bytes: buffer.length,
        tags,
        created_by: session.userId,
      })
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);

    return json({
      ok: true,
      media: {
        ...data,
        public_url: publicUrl(supabase, storagePath),
      },
    });
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

    const patch: Record<string, unknown> = {};
    if (body.filename !== undefined) {
      const filename = cleanText(body.filename, 160);
      if (!filename) return json({ ok: false, error: "filename required" }, 400);
      patch.filename = filename;
    }
    if (body.folder !== undefined) {
      patch.folder = cleanText(body.folder, 80) ?? "general";
    }
    if (body.alt !== undefined) patch.alt = cleanText(body.alt, 300);
    if (body.tags !== undefined) patch.tags = cleanStringArray(body.tags);

    if (Object.keys(patch).length === 0) {
      return json({ ok: false, error: "nothing to update" }, 400);
    }

    const { data, error } = await supabase
      .from("site_media")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    if (!data) return json({ ok: false, error: "not found" }, 404);
    return json({
      ok: true,
      media: {
        ...data,
        public_url: publicUrl(supabase, String(data.storage_path)),
      },
    });
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

    const { data: existing, error: loadErr } = await supabase
      .from("site_media")
      .select("id,storage_path")
      .eq("id", id)
      .maybeSingle();
    if (loadErr) return json({ ok: false, error: loadErr.message }, 500);
    if (!existing) return json({ ok: false, error: "not found" }, 404);

    await supabase.storage.from(BUCKET).remove([String(existing.storage_path)]);
    const { error } = await supabase.from("site_media").delete().eq("id", id);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  } catch (e) {
    return adminError(e);
  }
}
