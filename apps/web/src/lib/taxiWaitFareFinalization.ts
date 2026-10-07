import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyClientWaitFeeAdded } from "@/lib/clientPushNotifications";
import { computeWaitTimerState } from "@/lib/waitFeeCalculator";
import { chargeWaitLateFeeIfEligible } from "@/lib/waitTimerLateFeeBilling";
import { isWaitTimerGpsValidated } from "@/lib/waitTimerTypes";
import { taxiWaitCentsToApply } from "@/lib/taxiWaitFare";

type RideWaitRow = {
  id: string;
  status: string | null;
  client_user_id: string | null;
  driver_id: string | null;
  currency: string | null;
  total_cents: number | null;
  gross_total_cents: number | null;
  wait_timer_started_at: string | null;
  driver_arrived_at: string | null;
  started_at: string | null;
  free_wait_minutes: number | null;
  wait_fee_status: string | null;
  wait_fee_applied_to_total: boolean | null;
  manual_arrival_required: boolean | null;
  driver_distance_to_target_meters: number | null;
};

/**
 * Freeze the pickup wait fee when the trip has started and add it once
 * to the quoted total. Collection uses the existing late-fee ledger.
 * The original captured Stripe PaymentIntent is not charged again.
 */
export async function finalizeTaxiWaitOnTripStart(
  supabaseAdmin: SupabaseClient,
  rideId: string,
): Promise<{ ok: true; fee_cents: number; applied_cents: number } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin
    .from("taxi_rides")
    .select(
      "id,status,client_user_id,driver_id,currency,total_cents,gross_total_cents,wait_timer_started_at,driver_arrived_at,started_at,free_wait_minutes,wait_fee_status,wait_fee_applied_to_total,manual_arrival_required,driver_distance_to_target_meters",
    )
    .eq("id", rideId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "ride_not_found" };

  const ride = data as RideWaitRow;
  const status = String(ride.status ?? "").toLowerCase();
  if (status !== "in_progress" && status !== "completed") {
    return { ok: true, fee_cents: 0, applied_cents: 0 };
  }
  if (!ride.started_at) {
    return { ok: true, fee_cents: 0, applied_cents: 0 };
  }

  const computed = computeWaitTimerState({
    waitTimerStartedAt: ride.wait_timer_started_at,
    driverArrivedAt: ride.driver_arrived_at,
    freeWaitMinutes: ride.free_wait_minutes ?? undefined,
    waitEndedAt: ride.started_at,
    entityKind: "taxi",
  });

  const gpsOk = isWaitTimerGpsValidated(ride);
  const feeCents = gpsOk ? computed.wait_fee_cents : 0;
  const applyCents = taxiWaitCentsToApply({
    feeCents,
    alreadyApplied: ride.wait_fee_applied_to_total === true,
  });

  if (ride.wait_fee_applied_to_total === true) {
    return { ok: true, fee_cents: feeCents, applied_cents: 0 };
  }

  if (feeCents > 0) {
    await chargeWaitLateFeeIfEligible(supabaseAdmin, {
      entityType: "taxi_ride",
      entityId: rideId,
    });
  }

  if (applyCents <= 0 && feeCents <= 0) {
    await supabaseAdmin
      .from("taxi_rides")
      .update({
        wait_fee_amount_cents: 0,
        wait_fee_minutes: 0,
        wait_fee_status: gpsOk ? "free" : "waived",
        wait_fee_applied_to_total: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rideId)
      .eq("wait_fee_applied_to_total", false);
    return { ok: true, fee_cents: 0, applied_cents: 0 };
  }

  const currency = String(ride.currency ?? "USD").toUpperCase();
  const nextTotal = Math.max(0, Number(ride.total_cents ?? 0)) + applyCents;
  const nextGross =
    Math.max(0, Number(ride.gross_total_cents ?? ride.total_cents ?? 0)) + applyCents;

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from("taxi_rides")
    .update({
      total_cents: nextTotal,
      gross_total_cents: nextGross,
      wait_fee_amount_cents: feeCents,
      wait_fee_minutes: computed.billable_minutes,
      wait_fee_currency: currency,
      wait_fee_status: feeCents > 0 ? "charged" : "free",
      wait_fee_applied_to_total: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", rideId)
    .eq("wait_fee_applied_to_total", false)
    .select("id")
    .maybeSingle();

  if (updateErr) return { ok: false, error: updateErr.message };

  if (updated?.id && feeCents > 0 && ride.client_user_id) {
    await notifyClientWaitFeeAdded({
      supabaseAdmin,
      userIds: [ride.client_user_id],
      entityType: "taxi_ride",
      entityId: rideId,
    });
  }

  return {
    ok: true,
    fee_cents: feeCents,
    applied_cents: updated?.id ? applyCents : 0,
  };
}
