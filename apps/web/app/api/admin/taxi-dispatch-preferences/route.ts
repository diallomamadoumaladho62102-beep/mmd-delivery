import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("taxi_drivers.read", request);
    const supabase = buildSupabaseAdminClient();

    const { data: rules, error } = await supabase
      .from("taxi_dispatch_preference_rules")
      .select("*")
      .eq("is_active", true)
      .order("country_code", { ascending: true, nullsFirst: true });

    if (error) return json({ ok: false, error: error.message }, 500);

    const { data: stats } = await supabase
      .from("taxi_preference_stats")
      .select("*")
      .order("stat_date", { ascending: false })
      .limit(30);

    return json({ ok: true, rules: rules ?? [], stats: stats ?? [] });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await assertStaffPermission("taxi_drivers.manage", request);
    const supabase = buildSupabaseAdminClient();
    const body = await request.json();
    const ruleId = String(body.rule_id ?? body.id ?? "").trim();

    if (!ruleId) return json({ ok: false, error: "rule_id_required" }, 400);

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.widen_delay_seconds !== undefined) {
      patch.widen_delay_seconds = Number(body.widen_delay_seconds);
    }
    if (body.preference_drop_order !== undefined) {
      patch.preference_drop_order = body.preference_drop_order;
    }
    if (body.enabled_preferences !== undefined) {
      patch.enabled_preferences = body.enabled_preferences;
    }
    if (body.is_active !== undefined) {
      patch.is_active = Boolean(body.is_active);
    }

    const { error } = await supabase
      .from("taxi_dispatch_preference_rules")
      .update(patch)
      .eq("id", ruleId);

    if (error) return json({ ok: false, error: error.message }, 500);

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "taxi_dispatch_preference_rules_update",
      targetType: "taxi_dispatch_preference_rules",
      targetId: ruleId,
      metadata: patch,
      request,
    });

    return json({ ok: true });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, status);
  }
}
