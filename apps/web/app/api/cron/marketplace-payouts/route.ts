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
import { executeMarketplacePayouts } from "@/lib/marketplacePayoutService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** Confirmed ceiling for this Vercel project (same as /api/ai/chat). */
export const maxDuration = 60;

const JOB = "marketplace-payouts";

export const MARKETPLACE_PAYOUT_BLOCKERS = [
  "executeMarketplacePayouts_is_stub_no_stripe_transfer",
  "sellers_table_has_no_stripe_connect_account_column",
  "no_seller_order_refund_or_dispute_columns",
  "no_persisted_transfer_idempotency_key",
  "no_atomic_processing_claim_for_live_transfer",
] as const;

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

async function handle(req: NextRequest) {
  const start = startCronRun(JOB, true);
  const limit = readCronBatchLimit(req.nextUrl.searchParams, 1);
  const trace = createCronPhaseTracer(JOB, start.run_id);
  trace.mark("request_received", { batch_size: limit });

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
            .limit(Math.max(0, limit)),
          supabaseAdmin
            .from("marketplace_driver_payouts")
            .select(
              "id,seller_order_id,driver_id,total_driver_payout_cents,currency,status,stripe_transfer_id,created_at"
            )
            .in("status", ["pending", "approved", "failed"])
            .order("updated_at", { ascending: true })
            .limit(Math.max(0, limit)),
        ]);

        trace.mark("supabase_query_finished", {
          detail: {
            seller_rows: (sellerRes.data ?? []).length,
            driver_rows: (driverRes.data ?? []).length,
          },
        });

        const execution = await executeMarketplacePayouts(supabaseAdmin, {
          limit: Math.max(0, limit),
        });

        const sellerCount = (sellerRes.data ?? []).length;
        const driverCount = (driverRes.data ?? []).length;

        return {
          ok: true as const,
          mode: "INVENTORY_ONLY" as const,
          live_execution_enabled: false,
          transfers_created: 0,
          blockers: [...MARKETPLACE_PAYOUT_BLOCKERS],
          note:
            "Marketplace Stripe transfers are not enabled. Cron inventories ledger state only.",
          seller_queue_error: sellerRes.error?.message ?? null,
          driver_queue_error: driverRes.error?.message ?? null,
          seller_payouts_count: sellerCount,
          driver_payouts_count: driverCount,
          seller_payouts: sellerRes.data ?? [],
          driver_payouts: driverRes.data ?? [],
          execution,
          scanned: sellerCount + driverCount,
          eligible: 0,
          processed: 0,
          skipped: sellerCount + driverCount,
          failed: 0,
        };
      },
      {
        lockedBy: `marketplace:${start.run_id}`,
        ttlSeconds: Math.ceil(CRON_JOB_BUDGET_MS / 1000) + 30,
      }
    );

    if (locked.ok === false) {
      const reason = String(locked.error ?? "lock_busy");
      const infraTimeout =
        reason === "supabase_timeout" || reason === "lock_timeout";
      trace.mark(reason === "lock_busy" ? "lock_busy" : "error", {
        detail: { error: locked.error },
      });
      trace.mark("response_sent");
      return json(
        finishCronRun(start, {
          ok: !infraTimeout,
          skipped: 1,
          reason,
          mode: "INVENTORY_ONLY",
          lock_acquired: false,
          transfers_created: 0,
          phases: trace.phases,
        }),
        infraTimeout ? 504 : 200
      );
    }

    trace.mark("processing_finished");
    trace.mark("response_sent");
    return json(
      finishCronRun(start, {
        ...locked.result,
        ok: true,
        lock_acquired: true,
        batch_limit: limit,
        phases: trace.phases,
        vercel_max_duration_sec: CRON_VERCEL_MAX_DURATION_SEC,
        job_budget_ms: CRON_JOB_BUDGET_MS,
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
        mode: "INVENTORY_ONLY",
        lock_acquired: false,
        transfers_created: 0,
        phases: trace.phases,
      }),
      error instanceof CronTimeoutError ? 504 : 500
    );
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
