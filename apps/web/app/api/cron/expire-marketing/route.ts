import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { buildCronSupabaseAdmin } from "@/lib/cronSupabase";
import { CRON_SUPABASE_TIMEOUT_MS } from "@/lib/cronTimeouts";
import { creditAvailableMarketingCashbackBatch } from "@/lib/marketing/marketingCashback";
import { processDriverMarketingObjectivesBatch } from "@/lib/marketing/marketingDriverRewards";

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
      activated: 0,
      ended: 0,
      expired_coupons: 0,
      expired_reservations: 0,
      cashback_available: 0,
    };
    let batches = 0;

    for (let i = 0; i < MAX_BATCHES; i += 1) {
      const { data, error } = await supabaseAdmin.rpc("mmd_marketing_expire_due_batch", {
        p_limit: BATCH_SIZE,
      });
      if (error) return json({ ok: false, error: error.message }, 500);
      const result = (data ?? {}) as Record<string, number>;
      totals.activated += Number(result.activated ?? 0);
      totals.ended += Number(result.ended ?? 0);
      totals.expired_coupons += Number(result.expired_coupons ?? 0);
      totals.expired_reservations += Number(result.expired_reservations ?? 0);
      totals.cashback_available += Number(result.cashback_available ?? 0);
      batches += 1;

      const moved =
        Number(result.activated ?? 0) +
        Number(result.ended ?? 0) +
        Number(result.expired_coupons ?? 0) +
        Number(result.expired_reservations ?? 0) +
        Number(result.cashback_available ?? 0);
      if (moved === 0) break;
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    }

    // Phase 7.1: credit available cashback → Crédit MMD (service_role RPC).
    const cashbackCredit = await creditAvailableMarketingCashbackBatch(
      supabaseAdmin,
      200
    );

    // Phase 7.1: qualify + pay driver monetary/points objectives.
    const driverRewards = await processDriverMarketingObjectivesBatch(
      supabaseAdmin,
      200
    );

    console.log("[cron:expire-marketing] done", {
      ...totals,
      batches,
      cashback_credit: cashbackCredit,
      driver_rewards: driverRewards,
    });

    return json({
      ok: true,
      ...totals,
      batches,
      cashback_credit: cashbackCredit,
      driver_rewards: driverRewards,
    });
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
