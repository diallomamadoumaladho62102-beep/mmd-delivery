import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { getAiAdminControlSnapshot } from "@/lib/ai/aiScopeGate";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function normalizePeriod(value: string | null): "today" | "7d" | "30d" {
  const raw = String(value ?? "today").trim().toLowerCase();
  if (raw === "7d" || raw === "30d") return raw;
  return "today";
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("mmd_ai.read", request);
    const supabase = buildSupabaseAdminClient();
    const period = normalizePeriod(request.nextUrl.searchParams.get("period"));

    const [metricsRes, geoRes, intentsRes, control] = await Promise.all([
      supabase.rpc("get_ai_metrics", { p_period: period }),
      supabase.rpc("get_ai_metrics_by_geo", { p_period: period }),
      supabase.rpc("get_ai_top_intents", { p_period: period, p_limit: 10 }),
      getAiAdminControlSnapshot(supabase),
    ]);

    if (metricsRes.error) {
      return json({ ok: false, error: metricsRes.error.message }, 500);
    }

    return json({
      ok: true,
      period,
      metrics: metricsRes.data,
      geo: geoRes.data ?? { by_country: [], by_state: [] },
      topIntents: intentsRes.data ?? [],
      control,
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
