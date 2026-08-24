import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageTaxiPayouts,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { ensureWorkerConnectCredit } from "@/lib/finance/ensureWorkerConnectCredit";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  taxi_ride_id?: string;
  rideId?: string;
  dry_run?: boolean;
};

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

async function authorizeRequest(req: NextRequest): Promise<string> {
  if (isAuthorizedCronRequest(req)) {
    return "cron:stripe_taxi_transfers";
  }
  const admin = await assertCanManageTaxiPayouts(req);
  return admin.userId;
}

export async function POST(req: NextRequest) {
  try {
    const actor = await authorizeRequest(req);
    const supabaseAdmin = buildSupabaseAdminClient();
    const body = (await req.json().catch(() => ({}))) as Body;
    const rideId = String(body.taxi_ride_id ?? body.rideId ?? "").trim();
    const dryRun = body.dry_run === true;

    if (!rideId) {
      return json({ error: "taxi_ride_id required" }, 400);
    }

    const result = await ensureWorkerConnectCredit(
      supabaseAdmin,
      { vertical: "taxi", taxiRideId: rideId },
      { dryRun, actor },
    );

    const detail =
      result.detail && typeof result.detail === "object"
        ? (result.detail as Record<string, unknown>)
        : {};

    if (result.ok === false) {
      return json(
        {
          ok: false,
          error: result.error,
          taxi_ride_id: rideId,
          engine: result.engine,
          stripe_code: detail.stripe_code ?? null,
          source_charge_id: detail.source_charge_id ?? null,
          ...detail,
        },
        Number(detail.httpStatus ?? 400) || 400,
      );
    }

    const transferId =
      result.transferId ??
      (typeof detail.transfer_id === "string" ? detail.transfer_id : null);
    const alreadySucceeded =
      result.already === true || detail.already_succeeded === true;

    if (
      !dryRun &&
      transferId &&
      !alreadySucceeded &&
      !actor.startsWith("cron:") &&
      !actor.startsWith("secret:") &&
      !actor.startsWith("system:")
    ) {
      await writeAdminAuditServer({
        supabaseAdmin,
        adminUserId: actor,
        action: "taxi_payout_transfer",
        targetType: "taxi_ride",
        targetId: rideId,
        newValues: {
          transfer_id: transferId,
          amount: detail.amount,
          stripe_amount: detail.stripe_amount,
          currency: detail.currency,
          destination: detail.destination,
        },
        metadata: { worker_finance_sct: true },
        request: req,
      });
    }

    return json({
      ok: true,
      dry_run: dryRun,
      already_succeeded: alreadySucceeded,
      taxi_ride_id: rideId,
      transfer_id: transferId,
      amount: detail.amount,
      stripe_amount: detail.stripe_amount,
      currency: detail.currency,
      destination: detail.destination,
      source_charge_id: detail.source_charge_id,
      idempotency_key: detail.idempotency_key,
      engine: result.engine,
      worker_finance_sct: true,
    });
  } catch (e) {
    if (e instanceof AdminAccessError) {
      return json({ error: "Forbidden" }, e.status);
    }
    console.error("[taxi-run] fatal error", e);
    return json({ error: "Internal server error" }, 500);
  }
}

export async function GET() {
  return json({ error: "Method not allowed" }, 405);
}
