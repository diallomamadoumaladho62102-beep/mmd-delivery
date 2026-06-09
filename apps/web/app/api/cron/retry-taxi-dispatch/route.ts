import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getDispatchSiteOrigin } from "@/lib/scheduleDeliveryRequestDispatch";
import {
  findTaxiRidesNeedingDispatchRetry,
  findTaxiRidesNeedingFavoriteFallback,
  resolveRetryDispatchWave,
  retryTaxiRideDispatch,
} from "@/lib/retryTaxiRideDispatch";

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
  return runRetryTaxiDispatch(request);
}

export async function POST(request: NextRequest) {
  return runRetryTaxiDispatch(request);
}

async function runRetryTaxiDispatch(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const dispatchSecret =
    process.env.DISPATCH_INTERNAL_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "";

  if (!dispatchSecret) {
    console.error(
      "[retry-taxi-dispatch] CRON BLOCKED: missing DISPATCH_INTERNAL_SECRET/CRON_SECRET"
    );
    return json({ error: "Missing DISPATCH_INTERNAL_SECRET/CRON_SECRET" }, 500);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  let orphanScan: Awaited<ReturnType<typeof findTaxiRidesNeedingDispatchRetry>>;
  let favoriteFallbacks;
  try {
    const [orphanResult, favoriteRows] = await Promise.all([
      findTaxiRidesNeedingDispatchRetry(supabase, 25),
      findTaxiRidesNeedingFavoriteFallback(supabase, 25),
    ]);
    orphanScan = orphanResult;
    favoriteFallbacks = favoriteRows;
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "orphan_scan_failed" },
      500
    );
  }

  const orphans = orphanScan.rides;
  const skipped = orphanScan.skipped;

  const queue = [...favoriteFallbacks, ...orphans];
  const seen = new Set<string>();
  const uniqueQueue = queue.filter((ride) => {
    if (seen.has(ride.id)) return false;
    seen.add(ride.id);
    return true;
  });

  const results: Record<string, unknown>[] = [];

  for (const ride of uniqueQueue) {
    const wave = resolveRetryDispatchWave(ride);

    try {
      const result = await retryTaxiRideDispatch({
        supabase,
        taxiRideId: ride.id,
        wave,
        source: "cron:retry-taxi-dispatch",
      });

      results.push({
        taxi_ride_id: ride.id,
        wave,
        ok: result.ok,
        message: result.message,
        error: result.error,
        candidates: result.candidates,
        notified: result.notified,
      });
    } catch (e) {
      results.push({
        taxi_ride_id: ride.id,
        wave,
        ok: false,
        error: e instanceof Error ? e.message : "retry_failed",
      });
    }
  }

  return json({
    ok: true,
    scanned: uniqueQueue.length,
    skipped: skipped.length,
    skipped_details: skipped,
    retried: results.length,
    results,
  });
}
