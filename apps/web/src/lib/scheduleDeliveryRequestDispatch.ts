import { buildDispatchInternalHeaders } from "@/lib/dispatchInternalAuth";
import { resolvePublicSiteOrigin, trustedInternalOrigin } from "@/lib/productionSite";

export function getDispatchSiteOrigin(): string | null {
  try {
    return resolvePublicSiteOrigin();
  } catch {
    return null;
  }
}

/** Fire-and-forget dispatch after a delivery request is marked paid. */
export function scheduleDeliveryRequestDispatch(params: {
  origin: string;
  deliveryRequestId: string;
}): boolean {
  const deliveryRequestId = params.deliveryRequestId;
  let origin: string;
  try {
    origin = trustedInternalOrigin(params.origin);
  } catch {
    console.error("[scheduleDeliveryRequestDispatch] skipped: untrusted origin");
    return false;
  }
  const headers = {
    "Content-Type": "application/json",
    ...buildDispatchInternalHeaders(),
  };

  if (!headers["x-dispatch-internal-secret"]) {
    console.log(
      "[scheduleDeliveryRequestDispatch] skipped: missing DISPATCH_INTERNAL_SECRET/CRON_SECRET"
    );
    return false;
  }

  void fetch(`${origin.replace(/\/$/, "")}/api/dispatch/delivery-request`, {
    method: "POST",
    headers,
    body: JSON.stringify({ deliveryRequestId, wave: 1 }),
  })
    .then(async (res) => {
      const body = await res.json().catch(() => null);
      console.log("[scheduleDeliveryRequestDispatch] response", {
        delivery_request_id: deliveryRequestId,
        http: res.status,
        ok: body?.ok ?? null,
        notified: body?.notified ?? null,
        candidates: body?.candidates ?? null,
        message: body?.message ?? body?.error ?? null,
      });
    })
    .catch((err) => {
      console.log(
        "[scheduleDeliveryRequestDispatch] async trigger failed:",
        err,
      );
    });
  return true;
}
