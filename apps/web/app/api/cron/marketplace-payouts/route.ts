import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { withCronJobLock } from "@/lib/cronJobLock";
import { finishCronRun, startCronRun } from "@/lib/cronObservability";
import { executeMarketplacePayouts } from "@/lib/marketplacePayoutService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JOB = "marketplace-payouts";

export const MARKETPLACE_PAYOUT_BLOCKERS = [
  "executeMarketplacePayouts_is_stub_no_stripe_transfer",
  "sellers_table_has_no_stripe_connect_account_column",
  "no_seller_order_refund_or_dispute_columns",
  "no_persisted_transfer_idempotency_key",
  "no_atomic_processing_claim_for_live_transfer",
] as const;

/**
 * Marketplace payout cron — INVENTORY_ONLY until financial model is complete.
 * Never creates Stripe Transfers from this route.
 */
function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase admin env");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function handle(req: NextRequest) {
  const start = startCronRun(JOB, true);

  try {
    if (!isAuthorizedCronRequest(req)) {
      return json(
        finishCronRun(start, {
          ok: false,
          error: "Unauthorized",
          lock_acquired: false,
        }),
        401
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    const locked = await withCronJobLock(
      supabaseAdmin,
      JOB,
      async () => {
        const [sellerRes, driverRes] = await Promise.all([
          supabaseAdmin
            .from("marketplace_seller_payouts")
            .select(
              "id,seller_order_id,seller_id,gross_amount_cents,platform_fee_cents,seller_net_amount_cents,currency,status,stripe_transfer_id,created_at"
            )
            .in("status", ["pending", "approved", "failed"])
            .order("updated_at", { ascending: true })
            .limit(50),
          supabaseAdmin
            .from("marketplace_driver_payouts")
            .select(
              "id,seller_order_id,driver_id,total_driver_payout_cents,currency,status,stripe_transfer_id,created_at"
            )
            .in("status", ["pending", "approved", "failed"])
            .order("updated_at", { ascending: true })
            .limit(50),
        ]);

        const execution = await executeMarketplacePayouts(supabaseAdmin, {
          limit: 50,
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
      { ttlSeconds: 10 * 60 }
    );

    if (!locked.ok) {
      return json(
        finishCronRun(start, {
          ok: true,
          skipped: 1,
          reason: "lock_busy",
          mode: "INVENTORY_ONLY",
          lock_acquired: false,
          transfers_created: 0,
        })
      );
    }

    return json(
      finishCronRun(start, {
        ...locked.result,
        ok: true,
        lock_acquired: true,
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[marketplace-payouts] fatal", {
      message,
      run_id: start.run_id,
    });
    return json(
      finishCronRun(start, {
        ok: false,
        error: "Internal server error",
        mode: "INVENTORY_ONLY",
        lock_acquired: false,
        transfers_created: 0,
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
