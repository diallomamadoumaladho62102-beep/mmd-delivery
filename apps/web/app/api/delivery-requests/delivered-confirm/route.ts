import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getDeliveryRequestId,
  mapDeliveryRpcError,
  syncLinkedOrderAfterDelivery,
  type DeliveryRequestRpcResult,
} from "@/lib/deliveryRequestDriver";
import { gateDeliveryRequestPlatformFeature } from "@/lib/platformRouteGuards";
import { chargeWaitLateFeeIfEligible } from "@/lib/waitTimerLateFeeBilling";
import { normalizeDeliveryProofPhotoUrl } from "@/lib/deliveryProofUrl";
import { awardDeliveryRequestLoyalty } from "@/lib/loyalty/loyaltyAccrual";
import { notifyDeliveryRequestCompleted } from "@/lib/deliveryCompletionNotifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function getBearer(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
}

function getAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
    { auth: { persistSession: false } }
  );
}

async function safeNotifyDeliveryCompleted(
  supabaseAdmin: ReturnType<typeof getAdminClient>,
  requestId: string,
  row: {
    client_user_id?: string | null;
    created_by?: string | null;
    driver_id?: string | null;
  },
) {
  try {
    return await notifyDeliveryRequestCompleted({
      supabaseAdmin,
      deliveryRequestId: requestId,
      clientUserIds: [row.client_user_id, row.created_by],
      driverUserId: row.driver_id,
    });
  } catch (err) {
    console.error("[delivery-request delivered-confirm] completion notify failed", {
      delivery_request_id: requestId,
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function triggerDriverPayoutForOrder(req: NextRequest, orderId: string) {
  const cronSecret = process.env.CRON_SECRET?.trim() || "";
  if (!cronSecret) {
    return { ok: false, error: "Missing CRON_SECRET" };
  }

  const endpoint = `${req.nextUrl.origin}/api/stripe/transfers/run`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cronSecret}`,
      "x-cron-secret": cronSecret,
    },
    body: JSON.stringify({ order_id: orderId, target: "driver" }),
    cache: "no-store",
  });

  const payload = await response.json().catch(() => null);

  return {
    ok: response.ok && payload?.ok === true,
    status: response.status,
    payload,
  };
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearer(req);
    if (!token) return json({ error: "Missing Authorization Bearer token" }, 401);

    const body = await req.json().catch(() => ({}));
    let requestId = "";

    try {
      requestId = getDeliveryRequestId(body as Record<string, unknown>);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Invalid request";
      return json({ error: message }, 400);
    }

    const dropoffCode = String(body.dropoff_code ?? body.code ?? "").trim() || null;

    const supabaseAdmin = getAdminClient();
    const { data: requestGate, error: requestGateErr } = await supabaseAdmin
      .from("delivery_requests")
      .select(
        "id,currency,pickup_lat,pickup_lng,leave_at_door,completion_reason,dropoff_photo_url,client_user_id,created_by,driver_id,status"
      )
      .eq("id", requestId)
      .maybeSingle();

    if (requestGateErr) {
      return json({ error: requestGateErr.message }, 500);
    }
    if (!requestGate) {
      return json({ error: "Delivery request not found" }, 404);
    }

    // Code-based handoff: proof photo is optional (same as pickup-confirm).
    // leave_at_door still requires a validated proof URL when completing that way.
    let proofPhotoUrl: string | null = null;
    const leaveAtDoor =
      requestGate.leave_at_door === true &&
      String(requestGate.completion_reason ?? "").toLowerCase() === "left_at_door";
    const rawProof = String(body.proof_photo_url ?? "").trim();
    const fromDeposit = String(requestGate.dropoff_photo_url ?? "").trim();
    const candidate = leaveAtDoor ? rawProof || fromDeposit : rawProof;
    if (candidate) {
      try {
        proofPhotoUrl = normalizeDeliveryProofPhotoUrl(candidate, {
          orderId: requestId,
        });
      } catch {
        return json({ error: "Invalid proof_photo_url" }, 400);
      }
    } else if (leaveAtDoor) {
      return json({ error: "Invalid proof_photo_url" }, 400);
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)!,
      {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      }
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user?.id) {
      return json({ error: "Invalid token" }, 401);
    }

    const platformGate = await gateDeliveryRequestPlatformFeature(
      supabaseAdmin,
      requestGate,
      "active"
    );
    if (platformGate.ok === false) {
      return json(platformGate.body, platformGate.status);
    }

    const { data, error } = await supabase.rpc("confirm_delivery_request_delivery", {
      p_request_id: requestId,
      p_dropoff_code: dropoffCode,
      p_proof_photo_url: proofPhotoUrl,
    });

    if (error) {
      return json({ error: error.message }, 500);
    }

    const result = (data ?? null) as DeliveryRequestRpcResult | null;

    if (!result?.ok) {
      const errCode = String(result?.error ?? result?.message ?? "");
      // Already delivered: still run completion notifications (idempotent dedup).
      // Does not re-run loyalty, payout, or late-fee billing.
      if (errCode === "invalid_status") {
        const { data: current } = await supabaseAdmin
          .from("delivery_requests")
          .select("id,status,client_user_id,created_by,driver_id")
          .eq("id", requestId)
          .maybeSingle();
        if (String(current?.status ?? "").toLowerCase() === "delivered") {
          const completion_notifications = await safeNotifyDeliveryCompleted(
            supabaseAdmin,
            requestId,
            current ?? requestGate,
          );
          return json({
            ok: true,
            already_delivered: true,
            delivery_request_id: requestId,
            completion_notifications,
          });
        }
      }
      const mapped = mapDeliveryRpcError(errCode);
      return json({ error: mapped.message }, mapped.status);
    }

    const linkedOrderId = await syncLinkedOrderAfterDelivery({
      supabaseAdmin,
      deliveryRequestId: requestId,
      proofPhotoUrl,
    });

    // Fire-and-forget; RPC is idempotent. Never block delivery confirmation.
    void awardDeliveryRequestLoyalty(supabaseAdmin, requestId);

    let payout: Record<string, unknown> = { attempted: false };

    if (linkedOrderId) {
      payout = {
        attempted: true,
        ...(await triggerDriverPayoutForOrder(req, linkedOrderId)),
      };
    }

    let lateFeeBilling: Awaited<ReturnType<typeof chargeWaitLateFeeIfEligible>> | null =
      null;

    try {
      lateFeeBilling = await chargeWaitLateFeeIfEligible(supabaseAdmin, {
        entityType: "delivery_request",
        entityId: requestId,
        orderId: linkedOrderId,
      });
    } catch (lateFeeErr) {
      console.error("[delivery-request delivered-confirm] wait late fee billing failed", {
        delivery_request_id: requestId,
        message: lateFeeErr instanceof Error ? lateFeeErr.message : String(lateFeeErr),
      });
    }

    // Completion pushes after confirm; fail-open (delivery already committed).
    const completion_notifications = await safeNotifyDeliveryCompleted(
      supabaseAdmin,
      requestId,
      requestGate,
    );

    return json({
      ok: true,
      delivery_request_id: requestId,
      linked_order_id: linkedOrderId,
      result,
      payout,
      late_fee_billing: lateFeeBilling,
      completion_notifications,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return json({ error: message }, 500);
  }
}
