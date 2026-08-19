import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageDeliveryRequests,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { adminCancelDeliveryRequestRefundCore } from "@/lib/adminCancelDeliveryRequestRefundCore";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(req: NextRequest) {
  try {
    const session = await assertCanManageDeliveryRequests(req);

    const body = await req.json().catch(() => ({}));
    const deliveryRequestId = String(
      (body as { deliveryRequestId?: string; id?: string }).deliveryRequestId ??
        (body as { id?: string }).id ??
        (body as { delivery_request_id?: string }).delivery_request_id ??
        "",
    ).trim();
    const adminReason = String(
      (body as { reason?: string }).reason ?? "admin_cancel_refund",
    ).trim();

    if (!deliveryRequestId) {
      return json({ error: "Missing deliveryRequestId" }, 400);
    }

    const supabaseAdmin = buildSupabaseAdminClient();
    const result = await adminCancelDeliveryRequestRefundCore({
      supabaseAdmin,
      stripe,
      deliveryRequestId,
      adminUserId: session.userId,
      adminReason,
    });

    await writeAdminAuditServer({
      supabaseAdmin,
      adminUserId: session.userId,
      action: "delivery_request_cancel_refund",
      targetType: "delivery_request",
      targetId: deliveryRequestId,
      newValues: (result.delivery_request ?? {}) as Record<string, unknown>,
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
      delivery_request: result.delivery_request,
      alreadyRefunded: result.alreadyRefunded,
      alreadyCanceled: result.alreadyCanceled,
      refundedNow: result.refundedNow,
      stripeRefund: result.stripeRefund,
      message: result.alreadyCanceled
        ? "Delivery request already canceled (idempotent)."
        : "Admin cancel/refund completed.",
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    const message = e instanceof Error ? e.message : "Server error";
    console.log("Admin delivery cancel refund error:", e);
    if (
      message.includes("pickup/dropoff evidence") ||
      message.includes("Force Complete")
    ) {
      return json({ error: message }, 409);
    }
    if (message === "Delivery request not found") {
      return json({ error: message }, 404);
    }
    return json({ error: message }, status);
  }
}

export async function GET() {
  return json({ error: "Method not allowed" }, 405);
}
