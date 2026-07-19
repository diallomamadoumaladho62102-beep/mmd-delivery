import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { resolveCronBaseUrl, runCronFanout } from "@/lib/cron/cronFanout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Hobby-safe consolidated money cron (once daily).
 * Fans out to existing Stripe/payout routes — each keeps its own lock + auth.
 */
const MONEY_PATHS = [
  "/api/cron/expire-stale-payments",
  "/api/cron/taxi-payouts",
  "/api/cron/marketplace-payouts",
  "/api/admin/process-payouts",
] as const;

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

  const baseUrl = resolveCronBaseUrl(req.url);
  const started = Date.now();
  const fanout = await runCronFanout([...MONEY_PATHS], {
    baseUrl,
    // Leave headroom under Vercel Hobby 60s ceiling.
    timeoutMs: 14_000,
  });

  console.log("[cron:daily-money] done", {
    ok: fanout.ok,
    failed: fanout.failed,
    durationMs: Date.now() - started,
    results: fanout.results.map((r) => ({
      path: r.path,
      ok: r.ok,
      status: r.status,
      skipped: r.skipped,
      error: r.error,
      durationMs: r.durationMs,
    })),
  });

  return json({
    ok: fanout.ok,
    orchestrator: "daily-money",
    failed: fanout.failed,
    duration_ms: Date.now() - started,
    results: fanout.results,
  }, fanout.ok ? 200 : 207);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
