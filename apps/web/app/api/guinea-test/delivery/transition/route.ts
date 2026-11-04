import { NextRequest } from "next/server";
import {
  mmdLocationJson,
  requireMmdLocationApiUser,
} from "@/lib/mmdLocationCore";
import { isGuineaIsolatedTestUserId } from "@/lib/guineaTestIsolation";
import { transitionIsolatedDeliveryRequest } from "@/lib/guineaIsolatedDeliveryJourney";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireMmdLocationApiUser(req);
  if (auth.ok === false) return auth.response;
  if (!isGuineaIsolatedTestUserId(auth.user.id)) {
    return mmdLocationJson({ ok: false, error: "guinea_isolated_actor_required" }, 403);
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const deliveryRequestId = String(
    body.delivery_request_id ?? body.deliveryRequestId ?? "",
  ).trim();
  const action = String(body.action ?? "").trim().toLowerCase();
  if (!deliveryRequestId) {
    return mmdLocationJson({ ok: false, error: "missing_delivery_request_id" }, 400);
  }
  if (!["pickup", "deliver", "complete", "cancel"].includes(action)) {
    return mmdLocationJson({ ok: false, error: "unsupported_action" }, 400);
  }

  try {
    const result = await transitionIsolatedDeliveryRequest({
      admin: auth.supabaseAdmin,
      actorUserId: auth.user.id,
      deliveryRequestId,
      action: action as "pickup" | "deliver" | "complete" | "cancel",
    });
    return mmdLocationJson({
      ok: true,
      previous_status: result.previousStatus,
      delivery_request_id: result.id,
      status: result.status,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Server error";
    const status =
      message === "guinea_isolated_actor_required" ||
      message === "guinea_isolated_delivery_required" ||
      message === "forbidden" ||
      message === "driver_actor_required"
        ? 403
        : message === "delivery_request_not_found"
          ? 404
          : 400;
    return mmdLocationJson({ ok: false, error: message }, status);
  }
}
