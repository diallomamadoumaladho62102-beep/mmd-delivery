import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { buildCronSupabaseAdmin } from "@/lib/cronSupabase";
import { CRON_SUPABASE_TIMEOUT_MS } from "@/lib/cronTimeouts";

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
    const BATCH_SIZE = 500;
    const MAX_BATCHES = 20;
    const TIME_BUDGET_MS = 45_000;
    const startedAt = Date.now();

    let totals = {
      expired_trials: 0,
      canceled_at_period_end: 0,
      expired_subs: 0,
      expired_benefits: 0,
    };
    let batches = 0;

    for (let i = 0; i < MAX_BATCHES; i += 1) {
      const { data, error } = await supabaseAdmin.rpc("mmd_subscription_expire_due_batch", {
        p_limit: BATCH_SIZE,
      });
      if (error) return json({ ok: false, error: error.message }, 500);
      const result = (data ?? {}) as Record<string, number>;
      totals.expired_trials += Number(result.expired_trials ?? 0);
      totals.canceled_at_period_end += Number(result.canceled_at_period_end ?? 0);
      totals.expired_subs += Number(result.expired_subs ?? 0);
      totals.expired_benefits += Number(result.expired_benefits ?? 0);
      batches += 1;
      const moved =
        Number(result.expired_trials ?? 0) +
        Number(result.canceled_at_period_end ?? 0) +
        Number(result.expired_subs ?? 0) +
        Number(result.expired_benefits ?? 0);
      if (moved === 0) break;
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    }

    console.log("[cron:expire-subscriptions] done", { ...totals, batches });
    return json({ ok: true, ...totals, batches });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Server error" }, 500);
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
