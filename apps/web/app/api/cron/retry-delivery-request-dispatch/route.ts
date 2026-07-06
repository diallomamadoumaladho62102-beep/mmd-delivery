import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  findDeliveryRequestsNeedingDispatchRetry,
  retryDeliveryRequestDispatch,
} from "@/lib/retryDeliveryRequestDispatch";

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
  return runRetryDeliveryRequestDispatch(request);
}

export async function POST(request: NextRequest) {
  return runRetryDeliveryRequestDispatch(request);
}

async function runRetryDeliveryRequestDispatch(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  let dueRows: Awaited<ReturnType<typeof findDeliveryRequestsNeedingDispatchRetry>>;
  try {
    dueRows = await findDeliveryRequestsNeedingDispatchRetry(supabase, 25);
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "delivery_request_scan_failed" },
      500
    );
  }

  const results: Record<string, unknown>[] = [];

  for (const row of dueRows) {
    try {
      const result = await retryDeliveryRequestDispatch({
        supabase,
        deliveryRequestId: row.id,
        wave: row.nextWave,
      });

      results.push({
        delivery_request_id: row.id,
        wave: row.nextWave,
        ok: result.ok,
        notified: result.notified,
        candidates: result.candidates,
        error: result.error ?? null,
      });
    } catch (e) {
      results.push({
        delivery_request_id: row.id,
        wave: row.nextWave,
        ok: false,
        error: e instanceof Error ? e.message : "retry_failed",
      });
    }
  }

  return json({
    ok: true,
    scanned: dueRows.length,
    retried: results.length,
    results,
  });
}
