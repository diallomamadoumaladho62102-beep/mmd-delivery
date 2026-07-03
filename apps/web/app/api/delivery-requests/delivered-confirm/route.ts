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
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

async function triggerDriverPayoutForOrder(req: NextRequest, orderId: string) {
  const adminSecret = process.env.STRIPE_TRANSFERS_ADMIN_SECRET?.trim() || "";
  if (!adminSecret) {
    return { ok: false, error: "Missing STRIPE_TRANSFERS_ADMIN_SECRET" };
  }

  const endpoint = `${req.nextUrl.origin}/api/stripe/transfers/run`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-secret": adminSecret,
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
        "id,currency,pickup_lat,pickup_lng,leave_at_door,completion_reason,dropoff_photo_url"
      )
      .eq("id", requestId)
      .maybeSingle();

    if (requestGateErr) {
      return json({ error: requestGateErr.message }, 500);
    }
    if (!requestGate) {
      return json({ error: "Delivery request not found" }, 404);
    }

    let proofPhotoUrl: string | null = null;
    if (
      requestGate.leave_at_door === true &&
      String(requestGate.completion_reason ?? "").toLowerCase() === "left_at_door"
    ) {
      const fromBody = String(body.proof_photo_url ?? "").trim();
      const fromDeposit = String(requestGate.dropoff_photo_url ?? "").trim();
      proofPhotoUrl = fromBody || fromDeposit || null;
      if (!proofPhotoUrl) {
        return json({ error: "Missing proof_photo_url" }, 400);
      }
    } else {
      proofPhotoUrl = String(body.proof_photo_url ?? "").trim() || null;
      if (!proofPhotoUrl) {
        return json({ error: "Missing proof_photo_url" }, 400);
      }
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
      const mapped = mapDeliveryRpcError(result?.error ?? result?.message ?? "");
      return json({ error: mapped.message }, mapped.status);
    }

    const linkedOrderId = await syncLinkedOrderAfterDelivery({
      supabaseAdmin,
      deliveryRequestId: requestId,
      proofPhotoUrl,
    });

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

    return json({
      ok: true,
      delivery_request_id: requestId,
      linked_order_id: linkedOrderId,
      result,
      payout,
      late_fee_billing: lateFeeBilling,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return json({ error: message }, 500);
  }
}
