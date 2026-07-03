import { NextRequest } from "next/server";
import {
  getBearerToken,
  getSupabaseAdminClient,
  getSupabaseUserClient,
  mmdLocationJson,
} from "@/lib/mmdLocationCore";
import { cancelTaxiNoShow } from "@/lib/waitTimerService";
import {
  chargeWaitLateFeeIfEligible,
  recordTaxiNoShowDriverCompensation,
} from "@/lib/waitTimerLateFeeBilling";
import { inferPlatformCountryCode } from "@/lib/platformLaunchControl";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const token = getBearerToken(req);
  if (!token) {
    return mmdLocationJson({ ok: false, error: "Missing Authorization Bearer token" }, 401);
  }

  const supabaseUser = getSupabaseUserClient(token);
  const { data: authData, error: authErr } = await supabaseUser.auth.getUser();
  if (authErr || !authData.user?.id) {
    return mmdLocationJson({ ok: false, error: "Invalid token" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const rideId = String(body.taxi_ride_id ?? body.ride_id ?? "").trim();
  if (!rideId) {
    return mmdLocationJson({ ok: false, error: "taxi_ride_id_required" }, 400);
  }

  try {
    const supabaseAdmin = getSupabaseAdminClient();
    const result = await cancelTaxiNoShow(supabaseAdmin, {
      rideId,
      driverUserId: authData.user.id,
    });

    if (result.ok === false) {
      return mmdLocationJson({ ok: false, error: result.error }, 409);
    }

    const feeResult = await chargeWaitLateFeeIfEligible(supabaseAdmin, {
      entityType: "taxi_ride",
      entityId: rideId,
    });

    const rideCompensationCents = Math.max(
      0,
      result.compensation_cents - result.wait_fee_cents
    );

    if (rideCompensationCents > 0) {
      const countryCode = inferPlatformCountryCode({ currency: result.currency });
      await recordTaxiNoShowDriverCompensation(supabaseAdmin, {
        rideId,
        driverUserId: authData.user.id,
        countryCode,
        currency: result.currency,
        rideCompensationCents,
        referenceId:
          feeResult.charged === true
            ? feeResult.payment_transaction_id
            : rideId,
      });
    }

    return mmdLocationJson({
      ...result,
      late_fee_billing: feeResult,
    });
  } catch (e) {
    return mmdLocationJson(
      { ok: false, error: e instanceof Error ? e.message : "taxi_no_show_cancel_failed" },
      500
    );
  }
}
