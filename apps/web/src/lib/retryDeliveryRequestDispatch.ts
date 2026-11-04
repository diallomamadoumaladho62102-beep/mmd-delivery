import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isDispatchableDeliveryRequest,
  runDeliveryRequestDispatch,
} from "@/lib/runDeliveryRequestDispatch";
import { isIsolatedFromLiveDispatch } from "@/lib/guineaTestIsolation";
import { withOptionalPaymentMethod } from "@/lib/markets/guineaLocalCashCollect";
import { inferPlatformCountryCode } from "@/lib/platformCountryInference";

const AUTO_RETRY_DELAY_MS = 20_000;

export async function findDeliveryRequestsNeedingDispatchRetry(
  supabase: SupabaseClient,
  limit = 25
): Promise<
  Array<{
    id: string;
    nextWave: number;
    lastWaveAt: string | null;
  }>
> {
  const cutoffIso = new Date(Date.now() - AUTO_RETRY_DELAY_MS).toISOString();

  // Paid (Stripe) or Guinea cash candidates. The per-row gate below keeps
  // pending_cash limited to payment_method=cash + GNF + GN. If payment_method
  // is not deployed, retry paid-only (US behaviour is unchanged).
  const { data: loaded, error } = await withOptionalPaymentMethod((includePaymentMethod) => {
    const base = supabase
      .from("delivery_requests")
      .select(
        `id,payment_status,${includePaymentMethod ? "payment_method," : ""}currency,status,driver_id,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,dispatch_wave_1_started_at,updated_at,client_user_id,created_by,is_test,archived_at,hidden_from_user`,
      )
      .is("driver_id", null);
    const filtered = includePaymentMethod
      ? base.in("payment_status", ["paid", "pending_cash"])
      : base.eq("payment_status", "paid");
    return filtered
      .in("status", ["pending", "paid_pending", "processing_pending"])
      .order("updated_at", { ascending: true })
      .limit(Math.max(limit * 3, 25));
  });

  if (error) {
    throw new Error(error.message);
  }

  const requests = (loaded ?? []) as unknown as Array<Record<string, unknown>>;

  const results: Array<{
    id: string;
    nextWave: number;
    lastWaveAt: string | null;
  }> = [];

  for (const request of requests) {
    const withCountry = {
      ...request,
      country_code: inferPlatformCountryCode({
        currency: request.currency,
        lat: request.dropoff_lat ?? request.pickup_lat,
        lng: request.dropoff_lng ?? request.pickup_lng,
      }),
    };
    if (!isDispatchableDeliveryRequest(withCountry)) continue;
    if (isIsolatedFromLiveDispatch(request)) continue;

    const requestId = String(request.id);
    const { data: offers, error: offersError } = await supabase
      .from("delivery_request_driver_offers")
      .select("wave,created_at")
      .eq("delivery_request_id", requestId)
      .order("wave", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);

    if (offersError) {
      throw new Error(offersError.message);
    }

    const offerWave = Number(offers?.[0]?.wave ?? 0);
    const wave1StartedAt =
      (request as { dispatch_wave_1_started_at?: string | null })
        .dispatch_wave_1_started_at ?? null;
    // If wave-1 locked with zero offers, treat lastWave as 1 so retry advances to wave 2.
    const lastWave =
      offerWave > 0 ? offerWave : wave1StartedAt ? 1 : 0;
    const lastWaveAt =
      offers?.[0]?.created_at ??
      wave1StartedAt ??
      (request.updated_at as string | null | undefined) ??
      null;

    if (lastWave >= 3) continue;
    if (!lastWaveAt || lastWaveAt > cutoffIso) continue;

    results.push({
      id: requestId,
      nextWave: Math.min(Math.max(lastWave, 0) + 1, 3),
      lastWaveAt,
    });

    if (results.length >= limit) break;
  }

  return results;
}

export async function retryDeliveryRequestDispatch(params: {
  supabase: SupabaseClient;
  deliveryRequestId: string;
  wave: number;
}) {
  return runDeliveryRequestDispatch({
    supabase: params.supabase,
    deliveryRequestId: params.deliveryRequestId,
    wave: params.wave,
  });
}
