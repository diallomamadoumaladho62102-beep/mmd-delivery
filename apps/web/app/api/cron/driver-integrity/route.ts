import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { buildCronSupabaseAdmin } from "@/lib/cronSupabase";
import { CRON_SUPABASE_TIMEOUT_MS } from "@/lib/cronTimeouts";
import { getDispatchSiteOrigin } from "@/lib/scheduleDeliveryRequestDispatch";
import { runDriverIntegrityScan } from "@/lib/driverIntegrity/scan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

async function run(request: NextRequest) {
  if (!isAuthorizedCronRequest(request)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = buildCronSupabaseAdmin(CRON_SUPABASE_TIMEOUT_MS);

  try {
    const result = await runDriverIntegrityScan(supabase, {
      origin: getDispatchSiteOrigin(),
    });
    return json({ ok: true, ...result, ran_at: new Date().toISOString() });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "scan_failed";
    return json({ ok: false, error: message }, 500);
  }
}

export async function GET(request: NextRequest) {
  return run(request);
}

export async function POST(request: NextRequest) {
  return run(request);
}
