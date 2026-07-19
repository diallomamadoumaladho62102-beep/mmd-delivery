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

    // Expire due professional benefits, activate scheduled ones, and end
    // rewards/rules past their end date — in bounded batches to avoid timeouts.
    const BATCH_SIZE = 500;
    const MAX_BATCHES = 50;
    const TIME_BUDGET_MS = 45_000;
    const startedAt = Date.now();

    let totalBenefits = 0;
    let totalRewards = 0;
    let totalRules = 0;
    let batches = 0;
    let remaining = 0;

    for (let i = 0; i < MAX_BATCHES; i += 1) {
      const { data, error } = await supabaseAdmin.rpc("mmd_restaurant_expire_due_batch", {
        p_limit: BATCH_SIZE,
      });
      if (error) {
        return json({ ok: false, error: error.message, expired_benefits: totalBenefits }, 500);
      }
      const result = (data ?? {}) as {
        expired_benefits?: number;
        ended_rewards?: number;
        ended_rules?: number;
        remaining_benefits?: number;
      };
      const expired = Number(result.expired_benefits ?? 0);
      totalBenefits += expired;
      totalRewards += Number(result.ended_rewards ?? 0);
      totalRules += Number(result.ended_rules ?? 0);
      remaining = Number(result.remaining_benefits ?? 0);
      batches += 1;
      if (expired === 0 && remaining === 0) break;
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    }

    console.log("[cron:expire-restaurant-benefits] done", {
      totalBenefits,
      totalRewards,
      totalRules,
      batches,
      remaining,
    });
    return json({
      ok: true,
      expired_benefits: totalBenefits,
      ended_rewards: totalRewards,
      ended_rules: totalRules,
      batches,
      remaining,
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
