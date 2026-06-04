import { buildDispatchInternalHeaders } from "@/lib/dispatchInternalAuth";

export function getDispatchSiteOrigin(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    "";

  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    return raw.replace(/\/$/, "");
  }
  return `https://${raw.replace(/\/$/, "")}`;
}

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
