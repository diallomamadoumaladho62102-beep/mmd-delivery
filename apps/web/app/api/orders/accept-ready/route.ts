import { NextRequest } from "next/server";
import {
  driverAcceptJson,
  getOrderId,
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

    const { error } = await auth.supabaseUser.rpc("driver_accept_ready_order", {
      p_order_id: orderId,
    });

    if (error) {
      return driverAcceptJson({ ok: false, error: error.message }, 500);
    }

    await fireFoodOrderDispatchedTransactional({
      supabaseAdmin: auth.supabaseAdmin,
      orderId,
    });

    return driverAcceptJson({ ok: true, order_id: orderId });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return driverAcceptJson({ ok: false, error: message }, 500);
  }
}

export async function GET() {
  return driverAcceptJson({ error: "Method not allowed" }, 405);
}
