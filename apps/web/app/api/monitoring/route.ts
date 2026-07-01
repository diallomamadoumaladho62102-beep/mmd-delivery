import { NextRequest, NextResponse } from "next/server";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { isInternalHealthAuthorized } from "@/lib/internalHealthAuth";
import {
  getRecentProductionCriticalErrors,
  runProductionMonitoringChecks,
} from "@/lib/productionMonitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isInternalHealthAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = buildSupabaseAdminClient();
    const snapshot = await runProductionMonitoringChecks(supabase);

    return NextResponse.json(
      {
        ...snapshot,
        recent_critical_errors: getRecentProductionCriticalErrors(20),
      },
      { status: 200 },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
