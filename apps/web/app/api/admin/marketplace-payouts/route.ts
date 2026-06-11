import { NextRequest, NextResponse } from "next/server";
import { AdminAccessError, assertStaffPermission } from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { isMarketplacePayoutsLiveEnabled } from "@/lib/marketplacePayout";
import {
  cancelMarketplacePayout,
  markMarketplacePayoutApproved,
  prepareMarketplaceDriverPayout,
  simulateMarketplaceJobDelivered,
  simulateMarketplacePayouts,
} from "@/lib/marketplacePayoutService";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("users.sellers.read", request);
    const supabase = buildSupabaseAdminClient();
    const limit = Math.min(
      Math.max(Number(new URL(request.url).searchParams.get("limit") ?? 100), 1),
      200
    );

    const [sellerRes, driverRes] = await Promise.all([
      supabase
        .from("marketplace_seller_payouts")
        .select(
          "id,seller_order_id,seller_id,gross_amount_cents,platform_fee_cents,seller_net_amount_cents,currency,status,stripe_transfer_id,payout_live_enabled,created_at,updated_at,sellers(business_name,country_code,city)"
        )
        .order("updated_at", { ascending: false })
        .limit(limit),
      supabase
        .from("marketplace_driver_payouts")
        .select(
          "id,marketplace_delivery_job_id,seller_order_id,driver_id,driver_earning_cents,bonus_cents,total_driver_payout_cents,currency,status,stripe_transfer_id,payout_live_enabled,created_at,updated_at"
        )
        .order("updated_at", { ascending: false })
        .limit(limit),
    ]);

    if (sellerRes.error) return json({ ok: false, error: sellerRes.error.message }, 500);
    if (driverRes.error) return json({ ok: false, error: driverRes.error.message }, 500);

    return json({
      ok: true,
      seller_payouts: sellerRes.data ?? [],
      driver_payouts: driverRes.data ?? [],
      payout_live_enabled: isMarketplacePayoutsLiveEnabled(),
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await assertStaffPermission("users.sellers.read", request);
    const supabase = buildSupabaseAdminClient();
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "").trim().toLowerCase();

    if (action === "approve") {
      const payoutType = body.payout_type === "driver" ? "driver" : "seller";
      const payoutId = String(body.payout_id ?? "").trim();
      if (!payoutId) return json({ ok: false, error: "payout_id_required" }, 400);

      const result = await markMarketplacePayoutApproved(supabase, {
        payoutType,
        payoutId,
      });
      if (!result.ok) return json({ ok: false, error: result.error }, 400);
      return json({ ok: true, payout: result.payout });
    }

    if (action === "cancel") {
      const payoutType = body.payout_type === "driver" ? "driver" : "seller";
      const payoutId = String(body.payout_id ?? "").trim();
      if (!payoutId) return json({ ok: false, error: "payout_id_required" }, 400);

      const result = await cancelMarketplacePayout(supabase, {
        payoutType,
        payoutId,
      });
      if (!result.ok) return json({ ok: false, error: result.error }, 400);
      return json({ ok: true, payout: result.payout });
    }

    if (action === "simulate") {
      const jobId = String(body.marketplace_delivery_job_id ?? "").trim();
      const driverUserId = body.driver_user_id
        ? String(body.driver_user_id).trim()
        : null;

      if (jobId) {
        const delivered = await simulateMarketplaceJobDelivered(supabase, {
          marketplaceDeliveryJobId: jobId,
          driverUserId,
          source: "admin_simulate",
        });
        if (!delivered.ok) return json({ ok: false, error: delivered.error }, 400);

        const driverPayout = await prepareMarketplaceDriverPayout(supabase, {
          marketplaceDeliveryJobId: jobId,
          source: "admin_simulate",
        });

        const simulation = await simulateMarketplacePayouts(supabase, {
          driverPayoutId: driverPayout.payout?.id ?? null,
        });

        return json({
          ok: true,
          job: delivered.job,
          driver_payout: driverPayout.payout ?? null,
          simulation: simulation.simulation ?? null,
          ignored: simulation.ignored ?? null,
        });
      }

      const sellerPayoutId = body.seller_payout_id
        ? String(body.seller_payout_id).trim()
        : null;
      const driverPayoutId = body.driver_payout_id
        ? String(body.driver_payout_id).trim()
        : null;

      const simulation = await simulateMarketplacePayouts(supabase, {
        sellerPayoutId,
        driverPayoutId,
      });

      return json({
        ok: true,
        simulation: simulation.simulation ?? null,
        ignored: simulation.ignored ?? null,
      });
    }

    return json({ ok: false, error: "invalid_action" }, 400);
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
