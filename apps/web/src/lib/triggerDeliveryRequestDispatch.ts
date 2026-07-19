import type { SupabaseClient } from "@supabase/supabase-js";
import { runDeliveryRequestDispatch } from "@/lib/runDeliveryRequestDispatch";
import {
  getDispatchSiteOrigin,
  scheduleDeliveryRequestDispatch,
} from "@/lib/scheduleDeliveryRequestDispatch";

/**
 * Primary post-payment dispatch path: run wave dispatch in-process (awaited).
 * HTTP schedule is only used as backup when the inline run fails.
 */
export async function triggerDeliveryRequestDispatch(params: {
  supabase: SupabaseClient;
  deliveryRequestId: string;
  wave?: number;
  alsoScheduleHttpOnFailure?: boolean;
}) {
  const {
    supabase,
    deliveryRequestId,
    wave = 1,
    alsoScheduleHttpOnFailure = true,
  } = params;

  const result = await runDeliveryRequestDispatch({
    supabase,
    deliveryRequestId,
    wave,
  });

  console.log("[triggerDeliveryRequestDispatch] inline result", {
    delivery_request_id: deliveryRequestId,
    ok: result.ok,
    wave: result.wave,
    notified: result.notified,
    candidates: result.candidates,
    maxMiles: result.maxMiles,
    message: result.message ?? result.error ?? null,
    offerStats: result.offerStats ?? null,
  });

  if (alsoScheduleHttpOnFailure && !result.ok) {
    const origin = getDispatchSiteOrigin();
    if (origin) {
      scheduleDeliveryRequestDispatch({ origin, deliveryRequestId });
    }
  }

  return result;
}
