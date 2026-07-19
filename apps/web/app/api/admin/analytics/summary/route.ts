import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { writeAnalyticsAudit } from "@/lib/analytics/analyticsAudit";
import { getAnalyticsModulePayload } from "@/lib/analytics/analyticsQuery";
import {
  isAnalyticsModule,
  parseAnalyticsFilters,
  type AnalyticsModule,
} from "@/lib/analytics/analyticsTypes";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    const session = await assertStaffPermission("analytics.read", request);
    const supabase = buildSupabaseAdminClient();
    const moduleParam = String(request.nextUrl.searchParams.get("module") ?? "global");
    if (!isAnalyticsModule(moduleParam)) {
      return json({ ok: false, error: "invalid_module" }, 400);
    }

    // Finance module requires analytics.finance
    if (moduleParam === "finance") {
      await assertStaffPermission("analytics.finance", request);
    }

    const filters = parseAnalyticsFilters(request.nextUrl.searchParams);
    const payload = await getAnalyticsModulePayload(supabase, {
      module: moduleParam as AnalyticsModule,
      filters,
      adminUserId: session.userId,
      skipCache: request.nextUrl.searchParams.get("fresh") === "1",
    });

    await writeAnalyticsAudit({
      supabase,
      adminUserId: session.userId,
      action: "module_view",
      module: moduleParam,
      filters: filters as Record<string, unknown>,
      request,
    });

    return json({ ok: true, ...payload });
  } catch (e) {
    if (e instanceof AdminAccessError) {
      return json({ ok: false, error: e.message }, e.status);
    }
    return json({ ok: false, error: e instanceof Error ? e.message : "error" }, 500);
  }
}
