import type { SupabaseClient } from "@supabase/supabase-js";
import {
  runDeliveryRequestDispatch,
  type RunDeliveryRequestDispatchResult,
} from "@/lib/runDeliveryRequestDispatch";
import {
  getDispatchSiteOrigin,
  scheduleDeliveryRequestDispatch,
} from "@/lib/scheduleDeliveryRequestDispatch";

/**
 * Primary post-payment dispatch path: run wave dispatch in-process (awaited).
 * HTTP schedule is only used as backup when the inline run fails.
 */
export type DeliveryDispatchRunner = (params: {
  supabase: SupabaseClient;
  deliveryRequestId: string;
  wave?: number;
}) => Promise<RunDeliveryRequestDispatchResult>;

export async function triggerDeliveryRequestDispatch(params: {
  supabase: SupabaseClient;
  deliveryRequestId: string;
  wave?: number;
  alsoScheduleHttpOnFailure?: boolean;
  run?: DeliveryDispatchRunner;
}) {
  const {
    supabase,
    deliveryRequestId,
    wave = 1,
    alsoScheduleHttpOnFailure = true,
    run = runDeliveryRequestDispatch,
  } = params;

  let result: RunDeliveryRequestDispatchResult;
  try {
    result = await run({
      supabase,
      deliveryRequestId,
      wave,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result = {
      ok: false,
      deliveryRequestId,
      wave,
      notified: 0,
      candidates: 0,
      maxMiles: 0,
      error: message,
    };
  }

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

  let retryScheduled = false;
  if (alsoScheduleHttpOnFailure && !result.ok) {
    const origin = getDispatchSiteOrigin();
    if (origin) {
      retryScheduled = scheduleDeliveryRequestDispatch({ origin, deliveryRequestId });
    }
  }

  return { ...result, retryScheduled };
}
