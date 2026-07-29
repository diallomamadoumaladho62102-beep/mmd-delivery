import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { withCronJobLock } from "@/lib/cronJobLock";
import { finishCronRun, startCronRun } from "@/lib/cronObservability";
import { createCronPhaseTracer } from "@/lib/cronPhaseTrace";
import { buildCronSupabaseAdmin } from "@/lib/cronSupabase";
import {
  CRON_JOB_BUDGET_MS,
  CRON_SUPABASE_TIMEOUT_MS,
  CRON_VERCEL_MAX_DURATION_SEC,
  CronTimeoutError,
  readCronBatchLimit,
} from "@/lib/cronTimeouts";
import {
  isMarketplacePayoutsLiveEnvEnabled,
  isMarketplaceSellerPayoutsE2EReady,
} from "@/lib/marketplaceLaunchControl";
import { executeMarketplacePayouts } from "@/lib/marketplacePayoutService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const JOB = "marketplace-payouts";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

async function handle(req: NextRequest) {
  const start = startCronRun(JOB, true);
  const limit = readCronBatchLimit(req.nextUrl.searchParams, 1);
  const inventoryOnly =
    req.nextUrl.searchParams.get("inventory_only") === "1" || limit === 0;
  const liveReady =
    isMarketplaceSellerPayoutsE2EReady() && isMarketplacePayoutsLiveEnvEnabled();
  const liveMode = liveReady && !inventoryOnly;

  const trace = createCronPhaseTracer(JOB, start.run_id);
  trace.mark("request_received", {
    batch_size: limit,
    detail: { live_mode: liveMode },
  });

  try {
    if (!isAuthorizedCronRequest(req)) {
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

    const supabaseAdmin = buildCronSupabaseAdmin(CRON_SUPABASE_TIMEOUT_MS);

    trace.mark("lock_attempt_started");
    const locked = await withCronJobLock(
      supabaseAdmin,
      JOB,
      async () => {
        trace.mark("lock_acquired");
        trace.mark("supabase_query_started", {
          detail: { query: "marketplace_payout_ledgers" },
        });

        const [sellerRes, driverRes] = await Promise.all([
          supabaseAdmin
            .from("marketplace_seller_payouts")
            .select(
              "id,seller_order_id,seller_id,gross_amount_cents,platform_fee_cents,seller_net_amount_cents,currency,status,stripe_transfer_id,created_at"
            )
            .in("status", ["pending", "approved", "failed"])
            .order("updated_at", { ascending: true })
            .limit(Math.max(0, limit || 20)),
          supabaseAdmin
            .from("marketplace_driver_payouts")
            .select(
              "id,seller_order_id,driver_id,total_driver_payout_cents,currency,status,stripe_transfer_id,created_at"
            )
            .in("status", ["pending", "approved", "failed"])
            .order("updated_at", { ascending: true })
            .limit(Math.max(0, limit || 20)),
        ]);

        trace.mark("supabase_query_finished", {
          detail: {
            seller_rows: (sellerRes.data ?? []).length,
            driver_rows: (driverRes.data ?? []).length,
          },
        });

        const execution = liveMode
          ? await executeMarketplacePayouts(supabaseAdmin, {
              limit: Math.max(0, limit),
            })
          : { ok: true as const, executed: 0, failed: 0, ignored: "inventory_only" };

        const sellerCount = (sellerRes.data ?? []).length;
        const driverCount = (driverRes.data ?? []).length;
        const transfersCreated = Number(execution.executed ?? 0);

        return {
          ok: true as const,
          mode: liveMode ? ("LIVE" as const) : ("INVENTORY_ONLY" as const),
          live_execution_enabled: liveMode,
          e2e_ready: isMarketplaceSellerPayoutsE2EReady(),
          payouts_env_enabled: isMarketplacePayoutsLiveEnvEnabled(),
          transfers_created: transfersCreated,
          blockers: liveMode
            ? []
            : [
                ...(isMarketplaceSellerPayoutsE2EReady()
                  ? []
                  : ["marketplace_seller_payouts_e2e_not_ready"]),
                ...(isMarketplacePayoutsLiveEnvEnabled()
                  ? []
                  : ["marketplace_payouts_live_env_disabled"]),
                ...(inventoryOnly ? ["inventory_only_request"] : []),
              ],
          seller_queue_error: sellerRes.error?.message ?? null,
          driver_queue_error: driverRes.error?.message ?? null,
          seller_payouts_count: sellerCount,
          driver_payouts_count: driverCount,
          seller_payouts: sellerRes.data ?? [],
          driver_payouts: driverRes.data ?? [],
          execution,
          scanned: sellerCount + driverCount,
          eligible: liveMode ? transfersCreated : 0,
          processed: transfersCreated,
          skipped: liveMode ? 0 : sellerCount + driverCount,
          failed: Number(execution.failed ?? 0),
        };
      },
      { timeoutMs: CRON_JOB_BUDGET_MS }
    );

    if (locked.ok === false) {
      return json(
        finishCronRun(start, {
          ok: true,
          skipped: 1,
          reason: "lock_not_acquired",
          lock_acquired: false,
          phases: trace.phases,
        })
      );
    }

    return json(
      finishCronRun(start, {
        ...locked.result,
        lock_acquired: true,
        phases: trace.phases,
        maxDuration: CRON_VERCEL_MAX_DURATION_SEC,
      })
    );
  } catch (e) {
    const message =
      e instanceof CronTimeoutError
        ? e.message
        : e instanceof Error
          ? e.message
          : String(e);
    return json(
      finishCronRun(start, {
        ok: false,
        error: message,
        lock_acquired: false,
        phases: trace.phases,
      }),
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
