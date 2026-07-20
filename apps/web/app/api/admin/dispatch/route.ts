import { NextRequest, NextResponse } from "next/server";
import {
  AdminAccessError,
  assertCanManageDispatch,
  assertStaffPermission,
} from "@/lib/adminServer";
import { writeAdminAuditServer } from "@/lib/adminAuditServer";
import { buildDispatchInternalHeaders } from "@/lib/dispatchInternalAuth";
import { getDispatchSiteOrigin } from "@/lib/scheduleDeliveryRequestDispatch";
import { buildSupabaseAdminClient } from "@/lib/supabaseAdmin";
import { applyLiveTripFilters } from "@/lib/tripVisibility";

export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function GET(request: NextRequest) {
  try {
    await assertStaffPermission("dispatch.read", request);
    const supabase = buildSupabaseAdminClient();

    const [attempts, schedules, pendingOrders] = await Promise.all([
      supabase
        .from("order_dispatch_attempts")
        .select("id, order_id, wave, status, notified_count, created_at")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("order_dispatch_wave_schedule")
        .select("id, order_id, next_wave, run_at, status, created_at")
        .order("run_at", { ascending: true })
        .limit(50),
      applyLiveTripFilters(
        supabase
          .from("orders")
          .select("id, status, kind, driver_id, payment_status, created_at")
          .in("status", ["pending", "ready", "dispatched"])
          .order("created_at", { ascending: false })
          .limit(50)
      ),
    ]);

    return json({
      ok: true,
      attempts: attempts.data ?? [],
      schedules: schedules.data ?? [],
      active_orders: pendingOrders.data ?? [],
      errors: {
        attempts: attempts.error?.message ?? null,
        schedules: schedules.error?.message ?? null,
        orders: pendingOrders.error?.message ?? null,
      },
    });
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await assertCanManageDispatch(request);
    const body = (await request.json().catch(() => ({}))) as {
      orderId?: string;
      deliveryRequestId?: string;
      wave?: number;
    };

    const origin = getDispatchSiteOrigin();
    if (!origin) {
      return json({ ok: false, error: "Missing site origin env" }, 500);
    }

    const headers = {
      "Content-Type": "application/json",
      ...buildDispatchInternalHeaders(),
    };

    if (!headers["x-dispatch-internal-secret"]) {
      return json({ ok: false, error: "Missing dispatch internal secret" }, 500);
    }

    const supabase = buildSupabaseAdminClient();
    let targetUrl = "";
    let payload: Record<string, unknown> = {};
    let targetId = "";

    if (body.deliveryRequestId) {
      targetUrl = `${origin}/api/dispatch/delivery-request`;
      targetId = String(body.deliveryRequestId);
      payload = { deliveryRequestId: targetId, wave: body.wave ?? 1 };
    } else if (body.orderId) {
      targetUrl = `${origin}/api/dispatch/smart`;
      targetId = String(body.orderId);
      payload = { orderId: targetId, wave: body.wave ?? 1 };
    } else {
      return json({ ok: false, error: "orderId or deliveryRequestId required" }, 400);
    }

    const res = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const out = await res.json().catch(() => ({}));

    await writeAdminAuditServer({
      supabaseAdmin: supabase,
      adminUserId: session.userId,
      action: "dispatch_triggered",
      targetType: body.deliveryRequestId ? "delivery_request" : "order",
      targetId,
      newValues: { wave: body.wave ?? 1, http_status: res.status, response: out },
      request,
    });

    return json({ ok: res.ok, status: res.status, data: out }, res.ok ? 200 : 502);
  } catch (e) {
    const status = e instanceof AdminAccessError ? e.status : 500;
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Server error" },
      status
    );
  }
}
