import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { buildCronSupabaseAdmin } from "@/lib/cronSupabase";
import { CRON_SUPABASE_TIMEOUT_MS } from "@/lib/cronTimeouts";
import { withCronJobLock } from "@/lib/cronJobLock";

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
    const asOf = new Date().toISOString().slice(0, 10);
    const locked = await withCronJobLock(
      supabaseAdmin,
      "recognize-finance-revenue",
      async () => {
        const { data, error } = await supabaseAdmin.rpc(
          "mmd_finance_recognize_revenue_batch",
          { p_as_of: asOf, p_limit: 200 }
        );
        if (error) return { ok: false as const, error: error.message };
        return { ok: true as const, result: data ?? {}, as_of: asOf };
      }
    );

    if (locked.ok === false) {
      return json({ ok: true, skipped: String(locked.error ?? "lock_busy") });
    }

    console.log("[cron:recognize-finance-revenue]", locked.result);
    return json(locked.result as Record<string, unknown>);
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
