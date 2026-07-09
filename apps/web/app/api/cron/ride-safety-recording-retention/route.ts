import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { createClient } from "@supabase/supabase-js";
import { processRideSafetyRecordingRetention } from "@/lib/rideSafetyRecording";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function isCronAuthorized(request: NextRequest): boolean {
  return isAuthorizedCronRequest(request);
}

export async function GET(request: NextRequest) {
  return runRetention(request);
}

export async function POST(request: NextRequest) {
  return runRetention(request);
}

async function runRetention(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  try {
    const result = await processRideSafetyRecordingRetention(supabase);
    return json({ ok: true, ...result, ran_at: new Date().toISOString() });
  } catch (e: unknown) {
    return json({ ok: false, error: e instanceof Error ? e.message : "retention_failed" }, 500);
  }
}
