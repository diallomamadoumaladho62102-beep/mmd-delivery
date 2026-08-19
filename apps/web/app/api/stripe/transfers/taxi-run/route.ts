import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageTaxiPayouts,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { executeTaxiDriverFareTransfer } from "@/lib/finance/executeTaxiDriverFareTransfer";

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

    const result = await executeTaxiDriverFareTransfer({
      supabaseAdmin,
      taxiRideId: rideId,
      dryRun,
      actor,
    });

    if (result.ok === false) {
      return json(
        {
          ok: false,
          error: result.error,
          taxi_ride_id: result.taxi_ride_id ?? rideId,
          ...(result.message ? { message: result.message } : {}),
          ...(result.stripe_code
            ? { stripe_code: result.stripe_code }
            : {}),
          ...(result.stripe_type
            ? { stripe_type: result.stripe_type }
            : {}),
          ...(result.source_charge_id
            ? { source_charge_id: result.source_charge_id }
            : {}),
          ...(result.destination ? { destination: result.destination } : {}),
          ...(result.country_code ? { country_code: result.country_code } : {}),
          ...(result.currency ? { currency: result.currency } : {}),
        },
        result.httpStatus ?? 400,
      );
    }

    if (
      result.ok &&
      !result.dry_run &&
      result.transfer_id &&
      !result.already_succeeded &&
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
          transfer_id: result.transfer_id,
          amount: result.amount,
          stripe_amount: result.stripe_amount,
          currency: result.currency,
          destination: result.destination,
        },
        metadata: {},
        request: req,
      });
    }

    return json({
      ok: true,
      dry_run: result.dry_run === true,
      already_succeeded: result.already_succeeded === true,
      taxi_ride_id: result.taxi_ride_id,
      transfer_id: result.transfer_id,
      amount: result.amount,
      stripe_amount: result.stripe_amount,
      currency: result.currency,
      destination: result.destination,
      source_charge_id: result.source_charge_id,
      idempotency_key: result.idempotency_key,
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
