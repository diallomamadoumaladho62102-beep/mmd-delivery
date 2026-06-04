import { DRIVER_ORDER_OFFER_TTL_SECONDS } from "@/lib/createDriverOrderOffers";

type DispatchCandidate = {
  driverId: string;
  distanceMiles: number;
};

type DeliveryRequestOfferContext = {
  id: string;
  pickup_address?: string | null;
  dropoff_address?: string | null;
  driver_delivery_payout?: unknown;
  delivery_fee?: unknown;
  total?: unknown;
  eta_minutes?: unknown;
};

function toNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function driverPriceCents(request: DeliveryRequestOfferContext): number | null {
  const payout =
    toNumber(request.driver_delivery_payout) ??
    toNumber(request.delivery_fee) ??
    toNumber(request.total);

  if (payout == null) return null;
  return Math.round(payout * 100);
}

export async function createDriverDeliveryRequestOffers(params: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  deliveryRequest: DeliveryRequestOfferContext;
  candidates: DispatchCandidate[];
  wave: number;
}): Promise<{ created: number; refreshed: number; skipped: number }> {
  const { supabase, deliveryRequest, candidates, wave } = params;

  if (candidates.length === 0) {
    return { created: 0, refreshed: 0, skipped: 0 };
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const expiresAt = new Date(
    now.getTime() + DRIVER_ORDER_OFFER_TTL_SECONDS * 1000
  ).toISOString();
  const priceCents = driverPriceCents(deliveryRequest);
  const etaMinutes = toNumber(deliveryRequest.eta_minutes);

  let created = 0;
  let refreshed = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    const driverId = String(candidate.driverId);
    if (!driverId) {
      skipped += 1;
      continue;
    }

    const { data: existing, error: existingError } = await supabase
      .from("delivery_request_driver_offers")
      .select("id,status,expires_at")
      .eq("delivery_request_id", deliveryRequest.id)
      .eq("driver_id", driverId)
      .eq("status", "pending")
      .gt("expires_at", nowIso)
      .maybeSingle();

    if (existingError) {
      console.log(
        "delivery_request_driver_offers lookup error:",
        existingError.message
      );
      skipped += 1;
      continue;
    }

    const offerRow = {
      delivery_request_id: deliveryRequest.id,
      driver_id: driverId,
      status: "pending",
      wave,
      pickup_address: deliveryRequest.pickup_address ?? null,
      dropoff_address: deliveryRequest.dropoff_address ?? null,
      driver_price_cents: priceCents,
      distance_miles: candidate.distanceMiles,
      eta_minutes: etaMinutes != null ? Math.round(etaMinutes) : null,
      expires_at: expiresAt,
      updated_at: nowIso,
    };

    if (existing?.id) {
      const { error: updateError } = await supabase
        .from("delivery_request_driver_offers")
        .update(offerRow)
        .eq("id", existing.id);

      if (updateError) {
        console.log(
          "delivery_request_driver_offers refresh error:",
          updateError.message
        );
        skipped += 1;
      } else {
        refreshed += 1;
      }
      continue;
    }

    await supabase
      .from("delivery_request_driver_offers")
      .update({ status: "expired", updated_at: nowIso })
      .eq("delivery_request_id", deliveryRequest.id)
      .eq("driver_id", driverId)
      .eq("status", "pending")
      .lte("expires_at", nowIso);

    const { error: insertError } = await supabase
      .from("delivery_request_driver_offers")
      .insert({
        ...offerRow,
        created_at: nowIso,
      });

    if (insertError) {
      if (insertError.code === "23505") {
        const { error: upsertError } = await supabase
          .from("delivery_request_driver_offers")
          .update(offerRow)
          .eq("delivery_request_id", deliveryRequest.id)
          .eq("driver_id", driverId)
          .eq("status", "pending");

        if (upsertError) {
          console.log(
            "delivery_request_driver_offers conflict update error:",
            upsertError.message
          );
          skipped += 1;
        } else {
          refreshed += 1;
        }
      } else {
        console.log(
          "delivery_request_driver_offers insert error:",
          insertError.message
        );
        skipped += 1;
      }
    } else {
      created += 1;
    }
  }

  return { created, refreshed, skipped };
}
