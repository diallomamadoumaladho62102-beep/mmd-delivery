import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { buildCronSupabaseAdmin } from "@/lib/cronSupabase";
import { CRON_SUPABASE_TIMEOUT_MS } from "@/lib/cronTimeouts";
import {
  processFinancePendingBatch,
  refreshFinanceBalances,
} from "@/lib/finance/financeEvents";

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
    const TIME_BUDGET_MS = 45_000;
    const started = Date.now();
    let batches = 0;
    let totals = { scanned: 0, posted: 0, failed: 0, skipped: 0 };

    while (Date.now() - started < TIME_BUDGET_MS && batches < 10) {
      const result = await processFinancePendingBatch(supabaseAdmin, 200);
      if (!result.ok) return json({ ok: false, error: result.error, ...totals, batches }, 500);
      totals.scanned += Number(result.scanned ?? 0);
      totals.posted += Number(result.posted ?? 0);
      totals.failed += Number(result.failed ?? 0);
      totals.skipped += Number(result.skipped ?? 0);
      batches += 1;
      if (!result.next_cursor) break;
      if (Number(result.scanned ?? 0) === 0) break;
    }

    const balances = await refreshFinanceBalances(supabaseAdmin);

    // Expire ready exports older than 7 days
    await supabaseAdmin
      .from("finance_report_exports")
      .update({ status: "expired" })
      .eq("status", "ready")
      .lt("expires_at", new Date().toISOString());

    console.log("[cron:process-finance] done", { ...totals, batches, balances });
    return json({ ok: true, ...totals, batches, balances });
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
