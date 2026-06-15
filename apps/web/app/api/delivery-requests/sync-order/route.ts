import { NextRequest } from "next/server";
import { mmdLocationJson } from "@/lib/mmdLocationCore";
import { requireDeliveryClientAuth } from "@/lib/deliveryRequestApiAuth";
import { syncPaidDeliveryRequestOrder } from "@/lib/deliveryRequestService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SyncOrderBody = {
  delivery_request_id?: string;
};

export async function POST(req: NextRequest) {
  const auth = await requireDeliveryClientAuth(req);
  if (auth.ok === false) return auth.response;

  let body: SyncOrderBody;
  try {
    body = (await req.json()) as SyncOrderBody;
  } catch {
    return mmdLocationJson({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const deliveryRequestId = String(body.delivery_request_id ?? "").trim();
  if (!deliveryRequestId) {
    return mmdLocationJson({ ok: false, error: "Missing delivery_request_id" }, 400);
  }

  const result = await syncPaidDeliveryRequestOrder(
    auth.supabaseAdmin,
    deliveryRequestId,
    auth.user.id
  );

  if (result.ok === false) {
    return mmdLocationJson({ ok: false, error: result.error }, 400);
  }

  return mmdLocationJson({ ok: true, order_id: result.orderId });
}
