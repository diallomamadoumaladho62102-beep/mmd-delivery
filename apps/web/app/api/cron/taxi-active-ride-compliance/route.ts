import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runActiveTaxiRideComplianceScan } from "@/lib/taxiActiveRideCompliance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function isCronAuthorized(request: NextRequest): boolean {
  const vercelCron = request.headers.get("x-vercel-cron");
  if (vercelCron) return true;

  const expected = (process.env.CRON_SECRET || "").trim();
  if (!expected) return false;

  const headerSecret = (request.headers.get("x-cron-secret") || "").trim();
  if (headerSecret && headerSecret === expected) return true;

  const authHeader = request.headers.get("authorization") || "";
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const bearer = bearerMatch?.[1]?.trim() ?? "";
  return bearer.length > 0 && bearer === expected;
}

export async function GET(request: NextRequest) {
  return runComplianceScan(request);
}

export async function POST(request: NextRequest) {
  return runComplianceScan(request);
}

async function runComplianceScan(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  try {
    const result = await runActiveTaxiRideComplianceScan(supabase);
    return json({ ok: true, ...result, ran_at: new Date().toISOString() });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "scan_failed";
    return json({ ok: false, error: message }, 500);
  }
}
