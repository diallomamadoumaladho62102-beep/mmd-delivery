import { NextRequest } from "next/server";
import {
  getBearerToken,
  getSupabaseAdminClient,
  getSupabaseUserClient,
  mmdLocationJson,
} from "@/lib/mmdLocationCore";
import { cancelTaxiNoShow } from "@/lib/waitTimerService";
import { recordWaitLateFeeLedgerEntries } from "@/lib/waitTimerLateFeeBridge";

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

    if (result.wait_fee_cents > 0 && result.client_user_ids[0]) {
      await recordWaitLateFeeLedgerEntries(supabaseAdmin, {
        entityType: "taxi_ride",
        entityId: rideId,
        clientUserId: result.client_user_ids[0],
        driverUserId: authData.user.id,
        countryCode: "US",
        currency: result.currency,
        feeCents: result.wait_fee_cents,
        referenceId: rideId,
      });
    }

    return mmdLocationJson(result);
  } catch (e) {
    return mmdLocationJson(
      { ok: false, error: e instanceof Error ? e.message : "taxi_no_show_cancel_failed" },
      500
    );
  }
}
