import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getDispatchSiteOrigin } from "@/lib/scheduleDeliveryRequestDispatch";
import {
  dispatchDueTaxiScheduledRide,
  findDueTaxiScheduledRides,
} from "@/lib/taxiScheduledDispatch";

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
  return runScheduledDispatch(request);
}

export async function POST(request: NextRequest) {
  return runScheduledDispatch(request);
}

async function runScheduledDispatch(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const origin = getDispatchSiteOrigin() || request.nextUrl.origin;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  let dueRows;
  try {
    dueRows = await findDueTaxiScheduledRides(supabase, 25);
  } catch (e) {
    return json(
      { error: e instanceof Error ? e.message : "scheduled_scan_failed" },
      500
    );
  }

  const results: Record<string, unknown>[] = [];

  for (const row of dueRows) {
    try {
      const result = await dispatchDueTaxiScheduledRide({
        supabase,
        scheduledId: row.id,
        origin,
      });
      results.push({
        scheduled_id: row.id,
        taxi_ride_id: row.taxi_ride_id,
        ok: true,
        result,
      });
    } catch (e) {
      results.push({
        scheduled_id: row.id,
        taxi_ride_id: row.taxi_ride_id,
        ok: false,
        error: e instanceof Error ? e.message : "dispatch_failed",
      });
    }
  }

  return json({
    ok: true,
    scanned: dueRows.length,
    dispatched: results.filter((r) => r.ok === true).length,
    results,
  });
}
