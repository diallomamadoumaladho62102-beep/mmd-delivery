import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertCanManageMmdAi } from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const SELECT =
  "country_code, region_code, region_name, region_type, ai_enabled, ai_enabled_updated_at, ai_enabled_updated_by";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ country_code: string; region_code: string }> }
) {
  try {
    const session = await assertCanManageMmdAi(request);
    const { country_code, region_code } = await context.params;
    const countryCode = country_code.trim().toUpperCase();
    const regionCode = region_code.trim().toLowerCase();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (typeof body.ai_enabled !== "boolean") {
      return json({ ok: false, error: "ai_enabled boolean required" }, 400);
    }

    const supabase = buildSupabaseAdminClient();
    const { data: existing, error: readErr } = await supabase
      .from("platform_regions")
      .select(SELECT)
      .eq("country_code", countryCode)
      .eq("region_code", regionCode)
      .maybeSingle();

    if (readErr) return json({ ok: false, error: readErr.message }, 500);
    if (!existing) return json({ ok: false, error: "Region not found" }, 404);

    const { data: updated, error: updateErr } = await supabase
      .from("platform_regions")
      .update({
        ai_enabled: body.ai_enabled,
        ai_enabled_updated_at: new Date().toISOString(),
        ai_enabled_updated_by: session.userId,
      })
      .eq("country_code", countryCode)
      .eq("region_code", regionCode)
      .select(SELECT)
      .maybeSingle();

    if (updateErr) return json({ ok: false, error: updateErr.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "mmd_ai_launch_updated",
      targetType: "platform_regions",
      targetId: `${countryCode}/${regionCode}`,
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
