import { NextRequest } from "next/server";
import {
  driverAcceptJson,
  getOrderId,
  getRpcRow,
  requireDriverAcceptUser,
} from "@/lib/driverAcceptApi";
import { fireFoodOrderDispatchedTransactional } from "@/lib/transactionalDispatchNotify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await requireDriverAcceptUser(req);
    if (auth.ok === false) return auth.response;

    const body = await req.json().catch(() => ({}));
    let orderId = "";

    try {
      orderId = getOrderId(body as Record<string, unknown>);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Invalid request";
      return driverAcceptJson({ ok: false, error: message }, 400);
    }

    const { data, error } = await auth.supabaseUser.rpc("driver_accept_ready_order", {
      p_order_id: orderId,
    });

    if (error) {
      return driverAcceptJson({ ok: false, error: error.message }, 500);
    }

    const result = getRpcRow<{ ok?: boolean; message?: string; order_id?: string }>(data);
    if (!result?.ok) {
      return driverAcceptJson(
        { ok: false, error: result?.message ?? "order_not_available" },
        409,
      );
    }

    const acceptedOrderId = String(result.order_id ?? orderId);
    await fireFoodOrderDispatchedTransactional({
      supabaseAdmin: auth.supabaseAdmin,
      orderId: acceptedOrderId,
    });

    return driverAcceptJson({ ok: true, order_id: acceptedOrderId, result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return driverAcceptJson({ ok: false, error: message }, 500);
  }
}

export async function GET() {
  return driverAcceptJson({ error: "Method not allowed" }, 405);
}
