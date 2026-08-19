import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageTaxiPayouts,
} from "@/lib/adminServer";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { stripe } from "@/lib/stripe";
import {
  classifyUnpaidDriverSctStatus,
  ensurePlatformManualPayoutSchedule,
  evaluatePlatformPayoutGuard,
} from "@/lib/finance/platformPayoutGuard";
import { taxiFareTransferGroup } from "@/lib/finance/taxiFareTransferGuards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/finance/driver-sct-reconciliation
 * READ-ONLY inventory of unpaid taxi SCTs + platform balance + payout schedule.
 * Also returns legacy_closed_items for audit (not unpaid / not retryable / no Stripe).
 */
export async function GET(req: NextRequest) {
  try {
    await assertCanManageTaxiPayouts(req);
    const admin = buildSupabaseAdminClient();

    const [
      { data: unpaid, error },
      { data: legacyClosed, error: legacyErr },
    ] = await Promise.all([
      admin
        .from("taxi_commissions")
        .select(
          "taxi_ride_id, driver_cents, platform_cents, driver_transfer_id, driver_paid_out, sct_closure_status, sct_closure_reason, sct_closed_at, currency, updated_at",
        )
        .is("driver_transfer_id", null)
        .is("sct_closure_status", null)
        .gt("driver_cents", 0)
        .limit(100),
      admin
        .from("taxi_commissions")
        .select(
          "id, taxi_ride_id, driver_cents, platform_cents, driver_transfer_id, driver_paid_out, sct_closure_status, sct_closure_reason, sct_closed_at, currency, updated_at",
        )
        .eq("sct_closure_status", "legacy_closed")
        .limit(50),
    ]);

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    if (legacyErr) {
      return NextResponse.json(
        { ok: false, error: legacyErr.message },
        { status: 500 },
      );
    }

    const unpaidRows = unpaid ?? [];
    const legacyClosedRows = legacyClosed ?? [];
    const rideIds = unpaidRows
      .map((r) => String(r.taxi_ride_id ?? "").trim())
      .filter(Boolean);

    const [{ data: rides }, bal, platformAcct] = await Promise.all([
      rideIds.length
        ? admin
            .from("taxi_rides")
            .select(
              "id, driver_id, status, payment_status, stripe_payment_intent_id, completed_at, currency",
            )
            .in("id", rideIds)
        : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
      stripe.balance.retrieve(),
      stripe.accounts.retrieve(),
    ]);

    const rideById = new Map<string, Record<string, unknown>>(
      (rides ?? []).map((r) => {
        const row = r as Record<string, unknown>;
        return [String(row.id ?? ""), row] as [string, Record<string, unknown>];
      }),
    );

    const availableUsd = (bal.available ?? [])
      .filter((b) => b.currency === "usd")
      .reduce((s, b) => s + b.amount, 0);
    const pendingUsd = (bal.pending ?? [])
      .filter((b) => b.currency === "usd")
      .reduce((s, b) => s + b.amount, 0);

    const unpaidDriverCents = unpaidRows.reduce(
      (s, r) => s + Math.max(0, Number(r.driver_cents ?? 0) || 0),
      0,
    );

    const payoutInterval = String(
      platformAcct.settings?.payouts?.schedule?.interval ?? "",
    )
      .trim()
      .toLowerCase();

    const items = [];
    for (const row of unpaidRows) {
      const rideId = String(row.taxi_ride_id ?? "").trim();
      const ride = rideById.get(rideId);
      const driverCents = Math.max(0, Number(row.driver_cents ?? 0) || 0);
      const classified = classifyUnpaidDriverSctStatus({
        driverCents,
        platformAvailableCents: availableUsd,
        driverTransferId: row.driver_transfer_id,
        sctClosureStatus: (row as { sct_closure_status?: string | null })
          .sct_closure_status,
      });

      let existingTransfers: Array<{ id: string; amount: number; reversed: boolean }> =
        [];
      try {
        const listed = await stripe.transfers.list({
          transfer_group: taxiFareTransferGroup(rideId),
          limit: 20,
        });
        existingTransfers = (listed.data ?? []).map((t) => ({
          id: t.id,
          amount: t.amount,
          reversed: Boolean(t.reversed),
        }));
      } catch {
        existingTransfers = [];
      }

      let connectAccountId: string | null = null;
      if (ride?.driver_id) {
        const driverId = String(ride.driver_id);
        const [{ data: features }, { data: dp }] = await Promise.all([
          admin
            .from("taxi_driver_features")
            .select("stripe_connect_account_id")
            .eq("user_id", driverId)
            .maybeSingle(),
          admin
            .from("driver_profiles")
            .select("stripe_account_id")
            .eq("user_id", driverId)
            .maybeSingle(),
        ]);
        connectAccountId =
          String(features?.stripe_connect_account_id ?? "").trim() ||
          String(dp?.stripe_account_id ?? "").trim() ||
          null;
      }

      items.push({
        taxi_ride_id: rideId,
        driver_id: (ride?.driver_id as string | null | undefined) ?? null,
        driver_cents: driverCents,
        platform_cents: row.platform_cents,
        currency: row.currency,
        ride_status: (ride?.status as string | null | undefined) ?? null,
        payment_status:
          (ride?.payment_status as string | null | undefined) ?? null,
        payment_intent_id:
          (ride?.stripe_payment_intent_id as string | null | undefined) ?? null,
        completed_at:
          (ride?.completed_at as string | null | undefined) ?? null,
        driver_transfer_id: row.driver_transfer_id,
        driver_paid_out: row.driver_paid_out ?? false,
        sct_closure_status: null,
        transfer_status: classified.status,
        stripe_error:
          classified.status ===
          "driver_payment_pending_insufficient_platform_balance"
            ? "balance_insufficient"
            : null,
        action_required: classified.action_required,
        can_retry_now: classified.can_retry_now,
        connected_account: connectAccountId,
        existing_transfers: existingTransfers,
        transfer_group: taxiFareTransferGroup(rideId),
        commission_updated_at: row.updated_at ?? null,
      });
    }

    // Audit-only: historical write-offs (never unpaid / never retry / no Stripe calls).
    const legacy_closed_items = legacyClosedRows.map((row) => {
      const rideId = String(row.taxi_ride_id ?? "").trim();
      return {
        commission_id: String((row as { id?: unknown }).id ?? ""),
        taxi_ride_id: rideId,
        driver_cents: Math.max(0, Number(row.driver_cents ?? 0) || 0),
        platform_cents: row.platform_cents,
        currency: row.currency,
        driver_transfer_id: row.driver_transfer_id,
        driver_paid_out: row.driver_paid_out ?? false,
        sct_closure_status: "legacy_closed" as const,
        sct_closure_reason:
          (row as { sct_closure_reason?: string | null }).sct_closure_reason ??
          null,
        sct_closed_at:
          (row as { sct_closed_at?: string | null }).sct_closed_at ?? null,
        transfer_status: "legacy_closed",
        action_required: null,
        can_retry_now: false,
        note: "Historical SCT write-off — Driver was never paid via Transfer; not unpaid inventory.",
      };
    });

    return NextResponse.json({
      ok: true,
      unpaid_count: unpaidRows.length,
      unpaid_driver_cents: unpaidDriverCents,
      platform_available_usd_cents: availableUsd,
      platform_pending_usd_cents: pendingUsd,
      shortfall_cents: Math.max(0, unpaidDriverCents - Math.max(0, availableUsd)),
      platform_payout_guard: evaluatePlatformPayoutGuard({
        unpaidDriverCents,
      }),
      platform_payout_schedule_interval: payoutInterval || null,
      platform_payouts_manual: payoutInterval === "manual",
      platform_account_id: platformAcct.id,
      items,
      legacy_closed_count: legacy_closed_items.length,
      legacy_closed_items,
      formula:
        "DRIVER_EARNINGS = TRANSFERRED + AWAITING_PLATFORM_TRANSFER; PLATFORM_NET ≈ GROSS - FEES - DRIVER_TRANSFERS - OTHER; legacy_closed is audit-only (not unpaid).",
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

/**
 * POST /api/admin/finance/driver-sct-reconciliation
 * Ensure platform payouts are Manual (API). Does not invent Transfers.
 * Body: { ensure_manual?: true }
 */
export async function POST(req: NextRequest) {
  try {
    await assertCanManageTaxiPayouts(req);
    const body = (await req.json().catch(() => ({}))) as {
      ensure_manual?: boolean;
    };
    if (body.ensure_manual === false) {
      return NextResponse.json({ ok: false, error: "nothing_to_do" }, { status: 400 });
    }

    const result = await ensurePlatformManualPayoutSchedule();
    if (result.ok === false) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error,
          requires_dashboard: result.requires_dashboard === true,
          dashboard_steps: [
            "Stripe Dashboard → Settings → Payouts (platform account)",
            "Set payout schedule to Manual",
            "Save",
            "Re-run GET /api/admin/finance/driver-sct-reconciliation to verify",
          ],
        },
        { status: 409 },
      );
    }

    return NextResponse.json({
      ok: true,
      ...result,
      message: result.already_manual
        ? "Platform payout schedule already Manual."
        : "Platform payout schedule set to Manual.",
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
