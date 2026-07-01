import { NextRequest } from "next/server";
import {
  driverAcceptJson,
  getOrderOfferId,
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
    let offerId = "";

    try {
      offerId = getOrderOfferId(body as Record<string, unknown>);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Invalid request";
      return driverAcceptJson({ ok: false, error: message }, 400);
    }

    const { data, error } = await auth.supabaseUser.rpc("driver_accept_order_offer", {
      p_offer_id: offerId,
    });

    if (error) {
      return driverAcceptJson({ ok: false, error: error.message }, 500);
    }

    const result = getRpcRow<{ ok?: boolean; message?: string; order_id?: string }>(data);

    if (!result?.ok) {
      return driverAcceptJson(
        { ok: false, error: result?.message ?? "offer_not_available" },
        409,
      );
    }

    const orderId = String(result.order_id ?? "");
    if (orderId) {
      await fireFoodOrderDispatchedTransactional({
        supabaseAdmin: auth.supabaseAdmin,
        orderId,
      });
    }

    return driverAcceptJson({ ok: true, offer_id: offerId, order_id: orderId, result });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return driverAcceptJson({ ok: false, error: message }, 500);
  }
}

export async function GET() {
  return driverAcceptJson({ error: "Method not allowed" }, 405);
}
