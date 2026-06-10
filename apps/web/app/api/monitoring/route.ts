import { NextRequest, NextResponse } from "next/server";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import {
  getRecentProductionCriticalErrors,
  runProductionMonitoringChecks,
} from "@/lib/productionMonitoring";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isMonitoringAuthorized(request: NextRequest): boolean {
  const vercelCron = request.headers.get("x-vercel-cron");
  if (vercelCron) return true;

  const expected =
    (process.env.MONITORING_SECRET || process.env.CRON_SECRET || "").trim();
  if (!expected) return false;

  const headerSecret = (request.headers.get("x-monitoring-secret") || "").trim();
  if (headerSecret && headerSecret === expected) return true;

  const authHeader = request.headers.get("authorization") || "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const bearer = bearerMatch?.[1]?.trim() ?? "";
  return bearer.length > 0 && bearer === expected;
}

export async function GET(request: NextRequest) {
  if (!isMonitoringAuthorized(request)) {
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
      {
        status: snapshot.ok ? 200 : 503,
        headers: { "Cache-Control": "no-store" },
      }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "monitoring_failed",
      },
      { status: 500 }
    );
  }
}
