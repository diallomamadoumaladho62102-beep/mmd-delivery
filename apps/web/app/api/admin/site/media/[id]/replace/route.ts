import { NextRequest } from "next/server";
import { assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { sniffImageMime } from "@/lib/uploadSecurity";
import { adminError, json } from "../../../_helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "site-media";
const MAX_BYTES = 8 * 1024 * 1024;

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, ctx: Ctx) {
  try {
    await assertStaffPermission("marketing.manage", request);
    const { id } = await ctx.params;
    const supabase = buildSupabaseAdminClient();

    const { data: existing, error: loadErr } = await supabase
      .from("site_media")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (loadErr) return json({ ok: false, error: loadErr.message }, 500);
    if (!existing) return json({ ok: false, error: "not found" }, 404);

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

    const storagePath = String(existing.storage_path);
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: sniffed.mime,
        upsert: true,
      });
    if (upErr) return json({ ok: false, error: upErr.message }, 500);

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("site_media")
      .update({
        mime: sniffed.mime,
        bytes: buffer.length,
        replaced_at: now,
      })
      .eq("id", id)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);

    const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(storagePath)
      .data.publicUrl;
    return json({
      ok: true,
      media: { ...data, public_url: publicUrl },
    });
  } catch (e) {
    return adminError(e);
  }
}
