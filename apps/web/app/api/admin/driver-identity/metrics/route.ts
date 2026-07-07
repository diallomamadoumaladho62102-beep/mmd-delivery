import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import {
  getIdentityOpsStats,
  getIdentityQueueMetrics,
} from "@/lib/driverIdentityOps";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function adminJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  try {
    await assertStaffPermission("drivers.identity.read", req);
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return adminJson({ ok: false, error: error.message }, error.status);
    }
    throw error;
  }

  const admin = buildSupabaseAdminClient();
  const [metrics, stats] = await Promise.all([
    getIdentityQueueMetrics(admin),
    getIdentityOpsStats(admin),
  ]);

  return adminJson({
    ok: true,
    metrics,
    stats,
  });
}
