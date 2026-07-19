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

    let totalContracts = 0;
    let totalCampaigns = 0;
    let totalOverrides = 0;
    let totalActivated = 0;
    let batches = 0;

    for (let i = 0; i < MAX_BATCHES; i += 1) {
      const { data, error } = await supabaseAdmin.rpc("mmd_commission_expire_due_batch", {
        p_limit: BATCH_SIZE,
      });
      if (error) {
        return json({ ok: false, error: error.message }, 500);
      }
      const result = (data ?? {}) as {
        expired_contracts?: number;
        ended_campaigns?: number;
        ended_overrides?: number;
        activated_overrides?: number;
      };
      const expired =
        Number(result.expired_contracts ?? 0) +
        Number(result.ended_campaigns ?? 0) +
        Number(result.ended_overrides ?? 0);
      totalContracts += Number(result.expired_contracts ?? 0);
      totalCampaigns += Number(result.ended_campaigns ?? 0);
      totalOverrides += Number(result.ended_overrides ?? 0);
      totalActivated += Number(result.activated_overrides ?? 0);
      batches += 1;
      if (expired === 0 && Number(result.activated_overrides ?? 0) === 0) break;
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    }

    console.log("[cron:expire-commission-rules] done", {
      totalContracts,
      totalCampaigns,
      totalOverrides,
      totalActivated,
      batches,
    });

    return json({
      ok: true,
      expired_contracts: totalContracts,
      ended_campaigns: totalCampaigns,
      ended_overrides: totalOverrides,
      activated_overrides: totalActivated,
      batches,
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
