import type { SupabaseClient } from "@supabase/supabase-js";
import { runDeliveryRequestDispatch } from "@/lib/runDeliveryRequestDispatch";

const AUTO_RETRY_DELAY_MS = 20_000;

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

function isDispatchableDeliveryRequest(request: {
  payment_status?: unknown;
  status?: unknown;
  driver_id?: unknown;
}) {
  if (request.driver_id) return false;
  if (normalize(request.payment_status) !== "paid") return false;

  const status = normalize(request.status);
  return (
    status === "pending" ||
    status === "paid_pending" ||
    status === "processing_pending"
  );
}

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

  const { data: requests, error } = await supabase
    .from("delivery_requests")
    .select("id,payment_status,status,driver_id,dispatch_wave_1_started_at,updated_at")
    .is("driver_id", null)
    .eq("payment_status", "paid")
    .in("status", ["pending", "paid_pending", "processing_pending"])
    .order("updated_at", { ascending: true })
    .limit(Math.max(limit * 3, 25));

  if (error) {
    throw new Error(error.message);
  }

  const results: Array<{
    id: string;
    nextWave: number;
    lastWaveAt: string | null;
  }> = [];

  for (const request of requests ?? []) {
    if (!isDispatchableDeliveryRequest(request)) continue;

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
      offers?.[0]?.created_at ?? wave1StartedAt ?? request.updated_at ?? null;

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
