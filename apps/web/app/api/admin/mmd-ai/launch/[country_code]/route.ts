import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageMmdAi,
  assertStaffPermission,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const SELECT =
  "country_code, country_name, ai_enabled, ai_enabled_updated_at, ai_enabled_updated_by";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function normalizeCountryCode(value: string) {
  return value.trim().toUpperCase();
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ country_code: string }> }
) {
  try {
    const session = await assertCanManageMmdAi(request);
    const { country_code } = await context.params;
    const countryCode = normalizeCountryCode(country_code);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (typeof body.ai_enabled !== "boolean") {
      return json({ ok: false, error: "ai_enabled boolean required" }, 400);
    }

    const supabase = buildSupabaseAdminClient();

    const { data: existing, error: readErr } = await supabase
      .from("platform_countries")
      .select(SELECT)
      .eq("country_code", countryCode)
      .maybeSingle();

    if (readErr) return json({ ok: false, error: readErr.message }, 500);
    if (!existing) return json({ ok: false, error: "Country not found" }, 404);

    const { data: updated, error: updateErr } = await supabase
      .from("platform_countries")
      .update({
        ai_enabled: body.ai_enabled,
        ai_enabled_updated_at: new Date().toISOString(),
        ai_enabled_updated_by: session.userId,
      })
      .eq("country_code", countryCode)
      .select(SELECT)
      .maybeSingle();

    if (updateErr) return json({ ok: false, error: updateErr.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "mmd_ai_launch_updated",
      targetType: "platform_countries",
      targetId: countryCode,
      oldValues: existing as Record<string, unknown>,
      newValues: (updated ?? {}) as Record<string, unknown>,
      request,
    });

    return json({ ok: true, item: updated });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ country_code: string }> }
) {
  try {
    await assertStaffPermission("mmd_ai.read", request);
    const { country_code } = await context.params;
    const countryCode = normalizeCountryCode(country_code);
    const supabase = buildSupabaseAdminClient();

    const { data, error } = await supabase
      .from("platform_countries")
      .select(SELECT)
      .eq("country_code", countryCode)
      .maybeSingle();

    if (error) return json({ ok: false, error: error.message }, 500);
    if (!data) return json({ ok: false, error: "Country not found" }, 404);

    return json({ ok: true, item: data });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
