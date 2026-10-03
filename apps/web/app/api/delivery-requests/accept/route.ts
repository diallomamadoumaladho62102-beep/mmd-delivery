import { NextRequest } from "next/server";
import {
  getDeliveryRequestId,
  mapDeliveryRpcError,
} from "@/lib/deliveryRequestDriver";
import {
  driverAcceptJson,
  getOptionalDeliveryRequestOfferId,
  getRpcRow,
  requireDriverAcceptUser,
} from "@/lib/driverAcceptApi";
import { fireDeliveryRequestDispatchedTransactional } from "@/lib/transactionalDispatchNotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireDriverAcceptUser(req);
    if (auth.ok === false) return auth.response;

    const body = await req.json().catch(() => ({}));
    let requestId = "";
    let offeredId: string | null = null;

    try {
      requestId = getDeliveryRequestId(body as Record<string, unknown>);
      offeredId = getOptionalDeliveryRequestOfferId(body as Record<string, unknown>);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Invalid request";
      return driverAcceptJson({ ok: false, error: message }, 400);
    }

    let offerQuery = auth.supabaseAdmin
      .from("delivery_request_driver_offers")
      .select("id, expires_at, status")
      .eq("delivery_request_id", requestId)
      .eq("driver_id", auth.user.id)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1);

    if (offeredId) {
      offerQuery = offerQuery.eq("id", offeredId);
    }

    const { data: offer, error: offerError } = await offerQuery.maybeSingle();

    if (offerError) {
      return driverAcceptJson({ ok: false, error: offerError.message }, 500);
    }
    if (!offer?.id) {
      return driverAcceptJson({ ok: false, error: "offer_required" }, 409);
    }

    const { data, error } = await auth.supabaseUser.rpc(
      "driver_accept_delivery_request_offer",
      { p_offer_id: offer.id }
    );

    if (error) {
      return driverAcceptJson({ ok: false, error: error.message }, 500);
    }

    const result = getRpcRow(data);
    if (!result?.ok) {
      const mapped = mapDeliveryRpcError(result?.message ?? result?.error ?? "");
      return driverAcceptJson({ ok: false, error: mapped.message }, mapped.status);
    }

    try {
      await fireDeliveryRequestDispatchedTransactional({
        supabaseAdmin: auth.supabaseAdmin,
        deliveryRequestId: requestId,
      });
    } catch (transactionalErr) {
      console.error("[delivery-requests/accept] transactional notification failed", {
        delivery_request_id: requestId,
        message:
          transactionalErr instanceof Error
            ? transactionalErr.message
            : String(transactionalErr),
      });
    }

    return driverAcceptJson({
      ok: true,
      delivery_request_id: requestId,
      offer_id: offer.id,
      result,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return driverAcceptJson({ ok: false, error: message }, 500);
  }
}

export async function GET() {
  return driverAcceptJson({ error: "Method not allowed" }, 405);
}
