import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageOrders,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { adminCancelOrderRefundCore } from "@/lib/adminCancelOrderRefundCore";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  try {
    const session = await assertCanManageOrders(req);

    const body = await req.json().catch(() => ({}));
    const orderId = String(
      (body as { orderId?: string; order_id?: string }).orderId ??
        (body as { order_id?: string }).order_id ??
        "",
    ).trim();
    const adminReason = String(
      (body as { reason?: string }).reason ?? "admin_cancel_refund",
    ).trim();

    if (!orderId) {
      return json({ error: "Missing orderId" }, 400);
    }

    const supabaseAdmin = buildSupabaseAdminClient();
    const result = await adminCancelOrderRefundCore({
      supabaseAdmin,
      stripe,
      orderId,
      adminUserId: session.userId,
      adminReason,
    });

    await writeAdminAuditServer({
      supabaseAdmin,
      adminUserId: session.userId,
      action: "order_cancel_refund",
      targetType: "order",
      targetId: orderId,
      newValues: (result.order ?? {}) as Record<string, unknown>,
      metadata: {
        reason: adminReason,
        refunded_now: result.refundedNow,
        already_canceled: result.alreadyCanceled,
        already_refunded: result.alreadyRefunded,
        stripe_refund: result.stripeRefund,
      },
      request: req,
    });

    return json({
      ok: true,
      order: result.order,
      alreadyRefunded: result.alreadyRefunded,
      alreadyCanceled: result.alreadyCanceled,
      refundedNow: result.refundedNow,
      stripeRefund: result.stripeRefund,
      message: result.alreadyCanceled
        ? "Order already canceled (idempotent)."
        : "Admin cancel/refund completed.",
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Server error";
    console.log("Admin cancel refund error:", e);
    if (
      message.includes("pickup/delivery evidence") ||
      message.includes("Force Complete")
    ) {
      return json({ error: message }, 409);
    }
    if (message === "Order not found") {
      return json({ error: message }, 404);
    }
    return json({ error: message }, status);
  }
}

export async function GET() {
  return json({ error: "Method not allowed" }, 405);
}
