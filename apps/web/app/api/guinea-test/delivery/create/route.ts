import { NextRequest } from "next/server";
import { mmdLocationJson } from "@/lib/mmdLocationCore";
import { requireDeliveryClientAuth } from "@/lib/deliveryRequestApiAuth";
import { isGuineaIsolatedTestUserId } from "@/lib/guineaTestIsolation";
import { createIsolatedGuineaDeliveryRequest } from "@/lib/guineaIsolatedDeliveryJourney";
import { buildDeliveryPricingResponse } from "@/lib/deliveryRequestApiShared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireDeliveryClientAuth(req);
  if (auth.ok === false) return auth.response;
  if (!isGuineaIsolatedTestUserId(auth.user.id)) {
    return mmdLocationJson({ ok: false, error: "guinea_isolated_actor_required" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return mmdLocationJson({ ok: false, error: "Invalid JSON body" }, 400);
  }

  try {
    const result = await createIsolatedGuineaDeliveryRequest({
      admin: auth.supabaseAdmin,
      clientId: auth.user.id,
      pickupAddress: String(body.pickup_address ?? body.pickupAddress ?? ""),
      dropoffAddress: String(body.dropoff_address ?? body.dropoffAddress ?? ""),
      pickupLat: Number(body.pickup_lat ?? body.pickupLat),
      pickupLng: Number(body.pickup_lng ?? body.pickupLng),
      dropoffLat: Number(body.dropoff_lat ?? body.dropoffLat),
      dropoffLng: Number(body.dropoff_lng ?? body.dropoffLng),
      title: String(body.title ?? "Package delivery"),
      description:
        body.description != null ? String(body.description) : null,
    });

    return mmdLocationJson({
      ok: true,
      isolated_rehearsal: true,
      delivery_request_id: result.deliveryRequestId,
      pickup_code: result.pickupCode,
      dropoff_code: result.dropoffCode,
      pricing: buildDeliveryPricingResponse(result.pricing),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    const status =
      message === "guinea_isolated_actor_required" ||
      message === "guinea_isolated_schema_not_ready"
        ? 403
        : 400;
    return mmdLocationJson({ ok: false, error: message }, status);
  }
}
