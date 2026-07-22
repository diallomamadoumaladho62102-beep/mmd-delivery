import { NextRequest } from "next/server";
import { requireTaxiApiUser, taxiJson } from "@/lib/taxiApi";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clean(value: unknown, max = 80): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t.slice(0, max) : null;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireTaxiApiUser(req);
    if (auth.ok === false) return auth.response;

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const event = String(body.event ?? "").trim().toLowerCase();
    const advertisementId = String(body.advertisement_id ?? "").trim();
    if (!advertisementId) {
      return taxiJson({ ok: false, error: "advertisement_id required" }, 400);
    }
    if (event !== "impression" && event !== "click") {
      return taxiJson({ ok: false, error: "event must be impression or click" }, 400);
    }

    const supabase = buildSupabaseAdminClient();
    const table =
      event === "click" ? "advertisement_clicks" : "advertisement_impressions";

    const { error } = await supabase.from(table).insert({
      advertisement_id: advertisementId,
      user_id: auth.user.id,
      country: clean(body.country),
      city: clean(body.city),
      language: clean(body.language, 16),
      placement: clean(body.placement, 64) ?? "client_home",
    });

    if (error) return taxiJson({ ok: false, error: error.message }, 500);
    return taxiJson({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return taxiJson({ ok: false, error: message }, 500);
  }
}
