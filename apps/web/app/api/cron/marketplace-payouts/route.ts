import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { withCronJobLock } from "@/lib/cronJobLock";
import { executeMarketplacePayouts } from "@/lib/marketplacePayoutService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JOB = "marketplace-payouts";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase admin env");
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Marketplace live Stripe execution is intentionally NOT enabled.
 * This cron inventories eligible ledger rows and calls the stub executor
 * (which never creates transfers). Always dry by design.
 */
async function handle(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
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

      return {
        ok: true as const,
        dry_run: true,
        live_execution_enabled: false,
        note:
          "Marketplace Stripe transfers are not enabled. Cron inventories ledger state only.",
        seller_queue_error: sellerRes.error?.message ?? null,
        driver_queue_error: driverRes.error?.message ?? null,
        seller_payouts: sellerRes.data ?? [],
        driver_payouts: driverRes.data ?? [],
        execution,
      };
    },
    { ttlSeconds: 10 * 60 }
  );

  if (!locked.ok) {
    return json({
      ok: true,
      skipped: true,
      reason: "lock_busy",
      job: JOB,
    });
  }

  return json(locked.result);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
