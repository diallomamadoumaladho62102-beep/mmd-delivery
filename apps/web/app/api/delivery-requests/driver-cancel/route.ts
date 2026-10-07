import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  getDeliveryRequestId,
  mapDeliveryRpcError,
  type DeliveryRequestRpcResult,
} from "@/lib/deliveryRequestDriver";
import { getSupabaseAdminClient } from "@/lib/driverAcceptApi";
import { expirePendingDeliveryRequestOffers } from "@/lib/expirePendingDriverOffers";
import { triggerDeliveryRequestDispatch } from "@/lib/triggerDeliveryRequestDispatch";
import {
  DELIVERY_DRIVER_CANCEL_REASONS,
  parseStructuredCancelReason,
} from "@/lib/cancellationReasons";
import { recordServiceCancellation } from "@/lib/serviceCancellationAudit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function getBearer(req: NextRequest) {
  const auth = req.headers.get("authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
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

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!,
      {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      }
    );

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user?.id) {
      return json({ error: "Invalid token" }, 401);
    }

    const parsedReason = parseStructuredCancelReason(
      {
        reasonCode: (body as Record<string, unknown>).reason_code ?? (body as Record<string, unknown>).reasonCode,
        reasonNote:
          (body as Record<string, unknown>).reason_detail ??
          (body as Record<string, unknown>).reason_note,
      },
      DELIVERY_DRIVER_CANCEL_REASONS,
    );
    if (parsedReason.ok === false) {
      return json(
        { error: parsedReason.error, allowed_reasons: parsedReason.allowed },
        400,
      );
    }

    const { data, error } = await supabase.rpc("driver_release_delivery_request", {
      p_request_id: requestId,
    });

    if (error) {
      return json({ error: error.message }, 500);
    }

    const result = (data ?? null) as DeliveryRequestRpcResult | null;

    if (!result?.ok) {
      const mapped = mapDeliveryRpcError(result?.message ?? result?.error ?? "");
      return json({ error: mapped.message }, mapped.status);
    }

    const supabaseAdmin = getSupabaseAdminClient();
    await recordServiceCancellation(supabaseAdmin, {
      entityType: "delivery_request",
      entityId: requestId,
      serviceType: "package",
      actorUserId: userData.user.id,
      actorRole: "driver",
      reasonCode: parsedReason.reasonCode,
      reasonNote: parsedReason.reasonNote,
      resultingStatus: "released",
      acceptanceRateImpact: false,
      cancellationSource: "driver_release",
      postAcceptance: true,
      metadata: { reassign: true },
    });
    await expirePendingDeliveryRequestOffers(supabaseAdmin, requestId);
    const smartDispatch = await triggerDeliveryRequestDispatch({
      supabase: supabaseAdmin,
      deliveryRequestId: requestId,
    });

    return json({
      ok: true,
      delivery_request_id: requestId,
      result,
      reassigned: true,
      smartDispatch,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Server error";
    return json({ error: message }, 500);
  }
}
