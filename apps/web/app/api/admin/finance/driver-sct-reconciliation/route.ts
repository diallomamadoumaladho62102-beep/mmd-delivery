import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageTaxiPayouts,
} from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/finance/driver-sct-reconciliation
 * READ-ONLY: unpaid taxi SCTs vs platform Stripe balance.
 */
export async function GET(req: NextRequest) {
  try {
    await assertCanManageTaxiPayouts(req);
    const admin = buildSupabaseAdminClient();

    const { data: unpaid, error } = await admin
      .from("taxi_commissions")
      .select(
        "taxi_ride_id, driver_cents, platform_cents, driver_transfer_id, driver_paid_out, currency",
      )
      .is("driver_transfer_id", null)
      .gt("driver_cents", 0)
      .limit(100);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const unpaidRows = unpaid ?? [];
    const unpaidDriverCents = unpaidRows.reduce(
      (s, r) => s + Math.max(0, Number(r.driver_cents ?? 0) || 0),
      0,
    );

    const bal = await stripe.balance.retrieve();
    const availableUsd = (bal.available ?? [])
      .filter((b) => b.currency === "usd")
      .reduce((s, b) => s + b.amount, 0);
    const pendingUsd = (bal.pending ?? [])
      .filter((b) => b.currency === "usd")
      .reduce((s, b) => s + b.amount, 0);

    const shortfall = Math.max(0, unpaidDriverCents - availableUsd);

    return NextResponse.json({
      ok: true,
      unpaid_count: unpaidRows.length,
      unpaid_driver_cents: unpaidDriverCents,
      unpaid_rides: unpaidRows.map((r) => ({
        taxi_ride_id: r.taxi_ride_id,
        driver_cents: r.driver_cents,
        platform_cents: r.platform_cents,
        currency: r.currency,
      })),
      platform_available_usd_cents: availableUsd,
      platform_pending_usd_cents: pendingUsd,
      shortfall_cents: shortfall,
      platform_payout_guard:
        unpaidDriverCents > 0
          ? "block_platform_payout_until_driver_sct"
          : "clear",
      formula:
        "DRIVER_EARNINGS = TRANSFERRED + PENDING_TRANSFER; PLATFORM_NET ≈ GROSS - FEES - DRIVER_TRANSFERS - OTHER",
    });
  } catch (e) {
    if (e instanceof AdminAccessError) {
      return NextResponse.json({ ok: false, error: e.message }, { status: e.status });
    }
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      { status: 500 },
    );
  }
}
