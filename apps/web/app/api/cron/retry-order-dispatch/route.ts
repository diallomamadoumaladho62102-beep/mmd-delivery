import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { createClient } from "@supabase/supabase-js";
import { buildDispatchInternalHeaders } from "@/lib/dispatchInternalAuth";
import { getDispatchSiteOrigin } from "@/lib/scheduleDeliveryRequestDispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function isCronAuthorized(request: NextRequest): boolean {
  return isAuthorizedCronRequest(request);
}

export async function GET(request: NextRequest) {
  return runRetryOrderDispatch(request);
}

export async function POST(request: NextRequest) {
  return runRetryOrderDispatch(request);
}

async function runRetryOrderDispatch(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const origin = getDispatchSiteOrigin();
  if (!origin) {
    return json({ error: "Missing site origin (canonical production site URL)" }, 500);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
    { auth: { persistSession: false } }
  );

  const nowIso = new Date().toISOString();

  const { data: dueRows, error: dueError } = await supabase
    .from("order_dispatch_wave_schedule")
    .select("id,order_id,next_wave,location_fresh_minutes,cooldown_seconds")
    .eq("status", "pending")
    .lte("run_at", nowIso)
    .order("run_at", { ascending: true })
    .limit(25);

  if (dueError) {
    return json({ error: dueError.message }, 500);
  }

  const dispatchHeaders = {
    "Content-Type": "application/json",
    ...buildDispatchInternalHeaders(),
  };

  if (!dispatchHeaders["x-dispatch-internal-secret"]) {
    return json({ error: "Missing DISPATCH_INTERNAL_SECRET/CRON_SECRET" }, 500);
  }

  const results: Record<string, unknown>[] = [];

  for (const row of dueRows ?? []) {
    const scheduleId = String(row.id);
    const orderId = String(row.order_id);
    const nextWave = Number(row.next_wave);

    try {
      const res = await fetch(`${origin}/api/dispatch/smart`, {
        method: "POST",
        headers: dispatchHeaders,
        body: JSON.stringify({
          orderId,
          wave: nextWave,
          locationFreshMinutes: row.location_fresh_minutes ?? 20,
          cooldownSeconds: row.cooldown_seconds ?? 60,
          autoRetry: true,
        }),
        cache: "no-store",
      });

      const body = await res.json().catch(() => ({}));

      await supabase
        .from("order_dispatch_wave_schedule")
        .update({
          status: res.ok ? "done" : "failed",
          processed_at: new Date().toISOString(),
        })
        .eq("id", scheduleId);

      results.push({
        schedule_id: scheduleId,
        order_id: orderId,
        wave: nextWave,
        http_status: res.status,
        ok: res.ok,
        body,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "dispatch fetch failed";

      await supabase
        .from("order_dispatch_wave_schedule")
        .update({
          status: "failed",
          processed_at: new Date().toISOString(),
        })
        .eq("id", scheduleId);

      results.push({
        schedule_id: scheduleId,
        order_id: orderId,
        wave: nextWave,
        ok: false,
        error: message,
      });
    }
  }

  return json({
    ok: true,
    processed: results.length,
    results,
  });
}
