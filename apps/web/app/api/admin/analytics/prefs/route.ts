import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeAnalyticsAudit } from "@/lib/analytics/analyticsAudit";
import { isAnalyticsModule } from "@/lib/analytics/analyticsTypes";
import { analyticsCacheInvalidate } from "@/lib/analytics/analyticsCache";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    const session = await assertStaffPermission("analytics.read", request);
    const supabase = buildSupabaseAdminClient();
    const moduleParam = String(request.nextUrl.searchParams.get("module") ?? "global");

    const [{ data: catalog }, { data: prefs }] = await Promise.all([
      supabase
        .from("analytics_card_catalog")
        .select("*")
        .eq("module", moduleParam)
        .order("sort_order", { ascending: true }),
      supabase
        .from("analytics_dashboard_prefs")
        .select("*")
        .eq("admin_user_id", session.userId)
        .eq("module", moduleParam)
        .maybeSingle(),
    ]);

    return json({
      ok: true,
      module: moduleParam,
      catalog: catalog ?? [],
      prefs: prefs ?? null,
    });
  } catch (e) {
    if (e instanceof AdminAccessError) {
      return json({ ok: false, error: e.message }, e.status);
    }
    return json({ ok: false, error: e instanceof Error ? e.message : "error" }, 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertStaffPermission("analytics.manage", request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const moduleParam = String(body.module ?? "global");
    if (!isAnalyticsModule(moduleParam)) {
      return json({ ok: false, error: "invalid_module" }, 400);
    }

    const visible = Array.isArray(body.visible_cards)
      ? body.visible_cards.map((v) => String(v))
      : [];
    const order = Array.isArray(body.card_order)
      ? body.card_order.map((v) => String(v))
      : visible;
    const refreshSeconds = Math.min(
      3600,
      Math.max(15, Number(body.refresh_seconds ?? 60) || 60)
    );

    const supabase = buildSupabaseAdminClient();
    const { data, error } = await supabase
      .from("analytics_dashboard_prefs")
      .upsert(
        {
          admin_user_id: session.userId,
          module: moduleParam,
          visible_cards: visible,
          card_order: order,
          refresh_seconds: refreshSeconds,
          filters: (body.filters as Record<string, unknown>) ?? {},
          updated_at: new Date().toISOString(),
        },
        { onConflict: "admin_user_id,module" }
      )
      .select("*")
      .maybeSingle();

    if (error) return json({ ok: false, error: error.message }, 500);

    analyticsCacheInvalidate(`analytics:${moduleParam}`);
    await writeAnalyticsAudit({
      supabase,
      adminUserId: session.userId,
      action: "prefs_update",
      module: moduleParam,
      request,
      metadata: { visible_cards: visible, refresh_seconds: refreshSeconds },
    });

    return json({ ok: true, prefs: data });
  } catch (e) {
    if (e instanceof AdminAccessError) {
      return json({ ok: false, error: e.message }, e.status);
    }
    return json({ ok: false, error: e instanceof Error ? e.message : "error" }, 500);
  }
}
