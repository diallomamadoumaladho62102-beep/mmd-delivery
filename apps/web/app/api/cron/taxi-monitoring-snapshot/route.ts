import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function isCronAuthorized(request: NextRequest): boolean {
  return isAuthorizedCronRequest(request);
}

export async function GET(request: NextRequest) {
  return runMonitoringSnapshot(request);
}

export async function POST(request: NextRequest) {
  return runMonitoringSnapshot(request);
}

async function runMonitoringSnapshot(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const { data, error } = await supabase.rpc("refresh_taxi_monitoring_snapshot");

  if (error) {
    return json({ ok: false, error: error.message }, 500);
  }

  return json({ ok: true, result: data ?? {} });
}
