import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CATEGORIES = [
  "Restaurants",
  "Marketplace",
  "Chauffeurs",
  "Promotions",
  "Partenaires",
  "Banques",
  "Orange Money",
  "Stripe",
  "Évènements",
  "Campagnes MMD",
] as const;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function cleanText(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t.slice(0, max) : null;
}

function cleanInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function cleanBool(value: unknown, fallback = true): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return fallback;
}

function cleanDate(value: unknown): string | null {
  const t = cleanText(value, 40);
  if (!t) return null;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("marketing.read", request);
    const supabase = buildSupabaseAdminClient();
    const params = request.nextUrl.searchParams;
    const placement = cleanText(params.get("placement"), 64);
    const activeOnly = params.get("active") === "1";
    const limit = Math.min(200, Math.max(1, Number(params.get("limit") ?? 100) || 100));

    let query = supabase
      .from("advertisements")
      .select("*")
      .order("priority", { ascending: false })
      .order("display_order", { ascending: true })
      .limit(limit);
    if (placement) query = query.eq("placement", placement);
    if (activeOnly) query = query.eq("is_active", true);

    const { data, error } = await query;
    if (error) return json({ ok: false, error: error.message }, 500);

    const ids = (data ?? []).map((r) => String(r.id));
    let impressionsByAd: Record<string, number> = {};
    let clicksByAd: Record<string, number> = {};

    if (ids.length > 0) {
      const [{ data: impressions }, { data: clicks }] = await Promise.all([
        supabase
          .from("advertisement_impressions")
          .select("advertisement_id")
          .in("advertisement_id", ids),
        supabase
          .from("advertisement_clicks")
          .select("advertisement_id")
          .in("advertisement_id", ids),
      ]);
      for (const row of impressions ?? []) {
        const id = String(row.advertisement_id);
        impressionsByAd[id] = (impressionsByAd[id] ?? 0) + 1;
      }
      for (const row of clicks ?? []) {
        const id = String(row.advertisement_id);
        clicksByAd[id] = (clicksByAd[id] ?? 0) + 1;
      }
    }

    const advertisements = (data ?? []).map((row) => {
      const id = String(row.id);
      const impressions = impressionsByAd[id] ?? 0;
      const clicks = clicksByAd[id] ?? 0;
      const ctr = impressions > 0 ? Number(((clicks / impressions) * 100).toFixed(2)) : 0;
      return {
        ...row,
        analytics: { impressions, clicks, ctr },
      };
    });

    return json({ ok: true, advertisements, categories: CATEGORIES });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

export async function POST(request: NextRequest) {
  try {
    await assertStaffPermission("marketing.manage", request);
    const supabase = buildSupabaseAdminClient();
    const contentType = request.headers.get("content-type") ?? "";

    // Image upload → Storage bucket `advertisements`
    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return json({ ok: false, error: "file required" }, 400);
      }
      const ext =
        file.type === "image/png"
          ? "png"
          : file.type === "image/webp"
            ? "webp"
            : file.type === "image/gif"
              ? "gif"
              : "jpg";
      const path = `client_home/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      const { error: upErr } = await supabase.storage
        .from("advertisements")
        .upload(path, buffer, { contentType: file.type || "image/jpeg", upsert: false });
      if (upErr) return json({ ok: false, error: upErr.message }, 500);
      const { data: pub } = supabase.storage.from("advertisements").getPublicUrl(path);
      return json({ ok: true, image_url: pub.publicUrl, path });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "upsert").trim();

    if (action === "delete") {
      const id = cleanText(body.id, 80);
      if (!id) return json({ ok: false, error: "id required" }, 400);
      const { error } = await supabase.from("advertisements").delete().eq("id", id);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true });
    }

    const title = cleanText(body.title, 160);
    const imageUrl = cleanText(body.image_url, 2000);
    if (!title || !imageUrl) {
      return json({ ok: false, error: "title and image_url required" }, 400);
    }

    const payload = {
      title,
      subtitle: cleanText(body.subtitle, 280),
      image_url: imageUrl,
      button_text: cleanText(body.button_text, 80),
      button_action: cleanText(body.button_action, 500),
      placement: cleanText(body.placement, 64) ?? "client_home",
      category: cleanText(body.category, 80) ?? "Campagnes MMD",
      country: cleanText(body.country, 80),
      city: cleanText(body.city, 80),
      language: cleanText(body.language, 16),
      audience: cleanText(body.audience, 80),
      priority: cleanInt(body.priority, 0),
      display_order: cleanInt(body.display_order, 0),
      start_date: cleanDate(body.start_date),
      end_date: cleanDate(body.end_date),
      is_active: cleanBool(body.is_active, true),
      updated_at: new Date().toISOString(),
    };

    const id = cleanText(body.id, 80);
    if (id) {
      const { data, error } = await supabase
        .from("advertisements")
        .update(payload)
        .eq("id", id)
        .select("*")
        .maybeSingle();
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, advertisement: data });
    }

    const { data, error } = await supabase
      .from("advertisements")
      .insert(payload)
      .select("*")
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true, advertisement: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
