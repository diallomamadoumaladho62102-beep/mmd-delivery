import { buildDispatchInternalHeaders } from "@/lib/dispatchInternalAuth";

/** Fire-and-forget dispatch after a delivery request is marked paid. */
export function scheduleDeliveryRequestDispatch(params: {
  origin: string;
  deliveryRequestId: string;
}) {
  const { origin, deliveryRequestId } = params;
  const headers = {
    "Content-Type": "application/json",
    ...buildDispatchInternalHeaders(),
  };

  if (!headers["x-dispatch-internal-secret"]) {
    console.log(
      "[scheduleDeliveryRequestDispatch] skipped: missing DISPATCH_INTERNAL_SECRET/CRON_SECRET"
    );
    return;
  }

  void fetch(`${origin.replace(/\/$/, "")}/api/dispatch/delivery-request`, {
    method: "POST",
    headers,
    body: JSON.stringify({ deliveryRequestId, wave: 1 }),
  }).catch((err) => {
    console.log("[scheduleDeliveryRequestDispatch] async trigger failed:", err);
  });
}
