import { NextRequest } from "next/server";
import {
  driverAcceptJson,
  getDeliveryRequestOfferId,
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
    let offerId = "";

    try {
      offerId = getDeliveryRequestOfferId(body as Record<string, unknown>);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Invalid request";
      return driverAcceptJson({ ok: false, error: message }, 400);
    }

    const { data, error } = await auth.supabaseUser.rpc(
      "driver_accept_delivery_request_offer",
      { p_offer_id: offerId },
    );

    if (error) {
      return driverAcceptJson({ ok: false, error: error.message }, 500);
    }

    const result = getRpcRow<{
      ok?: boolean;
      message?: string;
      delivery_request_id?: string;
    }>(data);

    if (!result?.ok) {
      return driverAcceptJson(
        { ok: false, error: result?.message ?? "offer_not_available" },
        409,
      );
    }

    const deliveryRequestId = String(result.delivery_request_id ?? "");
    if (deliveryRequestId) {
      await fireDeliveryRequestDispatchedTransactional({
        supabaseAdmin: auth.supabaseAdmin,
        deliveryRequestId,
      });
    }

    return driverAcceptJson({
      ok: true,
      offer_id: offerId,
      delivery_request_id: deliveryRequestId,
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
