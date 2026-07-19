import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { buildCronSupabaseAdmin } from "@/lib/cronSupabase";
import { CRON_SUPABASE_TIMEOUT_MS } from "@/lib/cronTimeouts";
import { analyticsCacheInvalidate } from "@/lib/analytics/analyticsCache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

async function handle(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  try {
    const supabaseAdmin = buildCronSupabaseAdmin(CRON_SUPABASE_TIMEOUT_MS);
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const results: Array<Record<string, unknown>> = [];
    for (const day of [yesterday, today]) {
      const { data, error } = await supabaseAdmin.rpc("mmd_analytics_refresh_daily", {
        p_day: day,
        p_country_code: null,
      });
      if (error) {
        results.push({ day, ok: false, error: error.message });
      } else {
        results.push({ day, ...(data as Record<string, unknown>) });
      }
    }

    analyticsCacheInvalidate("analytics:");
    console.log("[cron:refresh-analytics] done", results);
    return json({ ok: true, results });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      500
    );
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
