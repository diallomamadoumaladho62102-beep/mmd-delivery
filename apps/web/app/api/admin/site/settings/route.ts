import { NextRequest } from "next/server";
import { assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { DEFAULT_SITE_LOCALE, type SiteSettingsPayload } from "@/lib/siteCms";
import {
  adminError,
  asObject,
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
      .from("site_settings")
      .select("*")
      .eq("locale", DEFAULT_SITE_LOCALE)
      .maybeSingle();
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({
      ok: true,
      settings: data ?? {
        locale: DEFAULT_SITE_LOCALE,
        payload: {},
        updated_at: null,
      },
    });
  } catch (e) {
    return adminError(e);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await assertStaffPermission("marketing.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const payload = asObject(body.payload) as SiteSettingsPayload;
    const now = new Date().toISOString();

    const { data, error } = await supabase
      .from("site_settings")
      .upsert(
        {
          locale: DEFAULT_SITE_LOCALE,
          payload,
          updated_at: now,
          updated_by: session.userId,
        },
        { onConflict: "locale" },
      )
      .select("*")
      .maybeSingle();

    if (error) return json({ ok: false, error: error.message }, 500);
    revalidateSiteCms();
    return json({ ok: true, settings: data });
  } catch (e) {
    return adminError(e);
  }
}
