import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageOrders,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { adminCancelOrderRefundCore } from "@/lib/adminCancelOrderRefundCore";
import { adminCancelDeliveryRequestRefundCore } from "@/lib/adminCancelDeliveryRequestRefundCore";
import { isAuthorizedCronRequest } from "@/lib/cronAuth";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { stripe } from "@/lib/stripe";
import {
  isAbandonedStaleAssignedJob,
  suggestedAdminActionForStaleJob,
} from "@/lib/adminStaleDriverJobs";

/** Audit FK requires a real profiles.id — cron actions attribute to founder with metadata.actor. */
const CRON_AUDIT_ADMIN_USER_ID = "379cb6a0-2e6e-43f5-b2de-dacac7144c94";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/ops/resolve-stale-job
 * Official Admin (or cron) resolution for abandoned assigned jobs.
 * action=cancel only — refuses when pickup/delivery evidence exists.
 */
function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

async function authorize(req: NextRequest): Promise<{
  actor: string;
  auditUserId: string;
}> {
  if (isAuthorizedCronRequest(req)) {
    return {
      actor: "cron:resolve_stale_job",
      auditUserId: CRON_AUDIT_ADMIN_USER_ID,
    };
  }
  const session = await assertCanManageOrders(req);
  return { actor: session.userId, auditUserId: session.userId };
}

export async function POST(req: NextRequest) {
  try {
    const { actor, auditUserId } = await authorize(req);
    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const id = String(body.id ?? body.jobId ?? body.job_id ?? "").trim();
    const sourceTable = String(
      body.source_table ?? body.sourceTable ?? "",
    )
      .trim()
      .toLowerCase();
    const action = String(body.action ?? "cancel")
      .trim()
      .toLowerCase();
    const reason = String(
      body.reason ?? "admin_stale_job_abandoned_cancel",
    ).trim();

    if (!id) return json({ ok: false, error: "Missing id" }, 400);
    if (sourceTable !== "orders" && sourceTable !== "delivery_requests") {
      return json(
        {
          ok: false,
          error: "source_table must be orders or delivery_requests",
        },
        400,
      );
    }
    if (action !== "cancel") {
      return json(
        {
          ok: false,
          error:
            "Only action=cancel is supported here. Use Force Complete endpoints when execution evidence exists.",
        },
        400,
      );
    }

    const supabaseAdmin = buildSupabaseAdminClient();

    if (sourceTable === "orders") {
      const { data: pre } = await supabaseAdmin
        .from("orders")
        .select(
          "id,status,updated_at,created_at,picked_up_at,delivered_at,payment_status,driver_id,driver_delivery_payout",
        )
        .eq("id", id)
        .maybeSingle();
      if (!pre) return json({ ok: false, error: "Order not found" }, 404);

      const result = await adminCancelOrderRefundCore({
        supabaseAdmin,
        stripe,
        orderId: id,
        adminUserId: actor,
        adminReason: reason,
      });

      await writeAdminAuditServer({
        supabaseAdmin,
        adminUserId: auditUserId,
        action: "stale_job_cancel",
        targetType: "order",
        targetId: id,
        oldValues: pre as Record<string, unknown>,
        newValues: (result.order ?? {}) as Record<string, unknown>,
        metadata: {
          reason,
          suggested: suggestedAdminActionForStaleJob(pre.status),
          was_abandoned_stale: isAbandonedStaleAssignedJob(pre),
          refunded_now: result.refundedNow,
          stripe_refund: result.stripeRefund,
          actor,
        },
        request: req,
      });

      return json({
        ok: true,
        source_table: "orders",
        result,
        message: "Stale order canceled via official Admin cancel/refund.",
      });
    }

    const { data: pre } = await supabaseAdmin
      .from("delivery_requests")
      .select(
        "id,status,updated_at,created_at,picked_up_at,delivered_at,dropoff_code_verified_at,payment_status,driver_id,driver_delivery_payout",
      )
      .eq("id", id)
      .maybeSingle();
    if (!pre) {
      return json({ ok: false, error: "Delivery request not found" }, 404);
    }

    const result = await adminCancelDeliveryRequestRefundCore({
      supabaseAdmin,
      stripe,
      deliveryRequestId: id,
      adminUserId: actor,
      adminReason: reason,
    });

    await writeAdminAuditServer({
      supabaseAdmin,
      adminUserId: auditUserId,
      action: "stale_job_cancel",
      targetType: "delivery_request",
      targetId: id,
      oldValues: pre as Record<string, unknown>,
      newValues: (result.delivery_request ?? {}) as Record<string, unknown>,
      metadata: {
        reason,
        suggested: suggestedAdminActionForStaleJob(pre.status),
        was_abandoned_stale: isAbandonedStaleAssignedJob(pre),
        refunded_now: result.refundedNow,
        stripe_refund: result.stripeRefund,
        actor,
      },
      request: req,
    });

    return json({
      ok: true,
      source_table: "delivery_requests",
      result,
      message:
        "Stale delivery request canceled via official Admin cancel/refund.",
    });
  } catch (e) {
    if (e instanceof AdminAccessError) {
      return json({ ok: false, error: e.message }, e.status);
    }
    const message = e instanceof Error ? e.message : "Server error";
    if (
      message.includes("evidence") ||
      message.includes("Force Complete")
    ) {
      return json({ ok: false, error: message }, 409);
    }
    console.log("resolve-stale-job error:", e);
    return json({ ok: false, error: message }, 500);
  }
}
