import { NextRequest, NextResponse } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLACEMENT_DEFAULT = "client_home";

export type ClientAdvertisementDto = {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string;
  button_text: string | null;
  button_action: string | null;
  category: string;
  priority: number;
  display_order: number;
};

function clean(value: string | null | undefined, max = 80): string | null {
  const t = String(value ?? "").trim();
  return t ? t.slice(0, max) : null;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const params = req.nextUrl.searchParams;
    const placement = clean(params.get("placement"), 64) ?? PLACEMENT_DEFAULT;
    const country = clean(params.get("country"), 80);
    const city = clean(params.get("city"), 80);
    const language = clean(params.get("language"), 16);
    const nowIso = new Date().toISOString();
    const limit = Math.min(20, Math.max(1, Number(params.get("limit") ?? 12) || 12));

    const supabase = buildSupabaseAdminClient();
    let query = supabase
      .from("advertisements")
      .select(
        "id, title, subtitle, image_url, button_text, button_action, category, priority, display_order, country, city, language, start_date, end_date, is_active",
      )
      .eq("is_active", true)
      .eq("placement", placement)
      .order("priority", { ascending: false })
      .order("display_order", { ascending: true })
      .limit(80);

    const { data, error } = await query;
    if (error) {
      // Table may not be migrated yet — home stays healthy with zero ads.
      const msg = String(error.message ?? "");
      if (/does not exist|schema cache|advertisements/i.test(msg)) {
        return taxiJson({ ok: true, advertisements: [] });
      }
      return taxiJson({ ok: false, error: error.message }, 500);
    }

    const rows = (data ?? []).filter((row) => {
      const startOk = !row.start_date || String(row.start_date) <= nowIso;
      const endOk = !row.end_date || String(row.end_date) >= nowIso;
      if (!startOk || !endOk) return false;
      if (row.country && country && String(row.country).toLowerCase() !== country.toLowerCase()) {
        return false;
      }
      if (row.city && city && String(row.city).toLowerCase() !== city.toLowerCase()) {
        return false;
      }
      if (row.language && language && String(row.language).toLowerCase() !== language.toLowerCase()) {
        return false;
      }
      return Boolean(row.image_url && row.title);
    });

    const advertisements: ClientAdvertisementDto[] = rows.slice(0, limit).map((row) => ({
      id: String(row.id),
      title: String(row.title),
      subtitle: row.subtitle != null ? String(row.subtitle) : null,
      image_url: String(row.image_url),
      button_text: row.button_text != null ? String(row.button_text) : null,
      button_action: row.button_action != null ? String(row.button_action) : null,
      category: String(row.category ?? "Campagnes MMD"),
      priority: Number(row.priority ?? 0),
      display_order: Number(row.display_order ?? 0),
    }));

    return taxiJson({ ok: true, advertisements });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}
