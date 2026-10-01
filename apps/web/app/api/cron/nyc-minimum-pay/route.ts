import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { closeDueMinimumPayPeriods } from "@/lib/minimumPay/closePayPeriod";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function handle(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }
  const supabase = buildSupabaseAdminClient();
  const result = await closeDueMinimumPayPeriods(supabase, "cron");
  return json({ ok: Boolean(result.ok), result });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
