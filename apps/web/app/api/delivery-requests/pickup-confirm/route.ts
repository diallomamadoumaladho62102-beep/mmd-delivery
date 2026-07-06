import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getDeliveryRequestId,
  mapDeliveryRpcError,
  syncLinkedOrderAfterPickup,
  type DeliveryRequestRpcResult,
} from "@/lib/deliveryRequestDriver";
import { gateDeliveryRequestPlatformFeature } from "@/lib/platformRouteGuards";
import { normalizeDeliveryProofPhotoUrl } from "@/lib/deliveryProofUrl";

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

    const pickupCode = String(body.pickup_code ?? body.code ?? "").trim() || null;
    let proofPhotoUrl: string | null = null;
    const rawProof = String(body.proof_photo_url ?? "").trim();
    if (rawProof) {
      try {
        proofPhotoUrl = normalizeDeliveryProofPhotoUrl(rawProof, {
          orderId: requestId,
        });
      } catch {
        return json({ error: "Invalid proof_photo_url" }, 400);
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

    const supabaseAdmin = getAdminClient();
    const { data: requestGate, error: requestGateErr } = await supabaseAdmin
      .from("delivery_requests")
      .select("id,currency,pickup_lat,pickup_lng")
      .eq("id", requestId)
      .maybeSingle();

    if (requestGateErr) {
      return json({ error: requestGateErr.message }, 500);
    }
    if (!requestGate) {
      return json({ error: "Delivery request not found" }, 404);
    }

    const platformGate = await gateDeliveryRequestPlatformFeature(
      supabaseAdmin,
      requestGate,
      "active"
    );
    if (platformGate.ok === false) {
      return json(platformGate.body, platformGate.status);
    }

    const { data, error } = await supabase.rpc("confirm_delivery_request_pickup", {
      p_request_id: requestId,
      p_pickup_code: pickupCode,
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

    const linkedOrderId = await syncLinkedOrderAfterPickup({
      supabaseAdmin,
      deliveryRequestId: requestId,
      proofPhotoUrl,
    });

    return json({
      ok: true,
      delivery_request_id: requestId,
      linked_order_id: linkedOrderId,
      result,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return json({ error: message }, 500);
  }
}
