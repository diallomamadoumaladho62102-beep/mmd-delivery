import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { buildCronSupabaseAdmin } from "@/lib/cronSupabase";
import { createCronPhaseTracer } from "@/lib/cronPhaseTrace";
import { finishCronRun, startCronRun } from "@/lib/cronObservability";
import {
  CRON_SUPABASE_TIMEOUT_MS,
  CRON_VERCEL_MAX_DURATION_SEC,
  CronTimeoutError,
} from "@/lib/cronTimeouts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = CRON_VERCEL_MAX_DURATION_SEC;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

async function runMonitoringSnapshot(request: NextRequest) {
  const start = startCronRun("taxi-monitoring-snapshot", false);
  const trace = createCronPhaseTracer("taxi-monitoring-snapshot", start.run_id);
  trace.mark("request_received");

  if (!isAuthorizedCronRequest(request)) {
    trace.mark("response_sent");
    return json(
      finishCronRun(start, {
        ok: false,
        error: "Unauthorized",
        lock_acquired: false,
        phases: trace.phases,
      }),
      401
    );
  }
  trace.mark("auth_validated");

  try {
    const supabase = buildCronSupabaseAdmin(CRON_SUPABASE_TIMEOUT_MS);
    trace.mark("supabase_query_started", {
      detail: { query: "refresh_taxi_monitoring_snapshot" },
    });
    const { data, error } = await supabase.rpc("refresh_taxi_monitoring_snapshot");
    trace.mark("supabase_query_finished");
    if (error) {
      trace.mark("response_sent");
      return json(
        finishCronRun(start, {
          ok: false,
          error: error.message,
          lock_acquired: false,
          phases: trace.phases,
        }),
        500
      );
    }
    trace.mark("response_sent");
    return json(
      finishCronRun(start, {
        ok: true,
        lock_acquired: false,
        result: data ?? {},
        phases: trace.phases,
        vercel_max_duration_sec: CRON_VERCEL_MAX_DURATION_SEC,
      })
    );
  } catch (error) {
    const code =
      error instanceof CronTimeoutError
        ? error.code
        : error instanceof Error
          ? error.message
          : String(error);
    trace.mark("error", { detail: { code } });
    trace.mark("response_sent");
    return json(
      finishCronRun(start, {
        ok: false,
        error: code,
        lock_acquired: false,
        phases: trace.phases,
      }),
      error instanceof CronTimeoutError ? 504 : 500
    );
  }
}

export async function GET(request: NextRequest) {
  return runMonitoringSnapshot(request);
}

export async function POST(request: NextRequest) {
  return runMonitoringSnapshot(request);
}
