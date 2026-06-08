import { buildDispatchInternalHeaders } from "@/lib/dispatchInternalAuth";

export function scheduleTaxiRideDispatch(params: {
  origin: string;
  taxiRideId: string;
  wave?: number;
}) {
  const { origin, taxiRideId, wave = 1 } = params;
  const headers = {
    "Content-Type": "application/json",
    ...buildDispatchInternalHeaders(),
  };

  if (!headers["x-dispatch-internal-secret"]) {
    console.log(
      "[scheduleTaxiRideDispatch] skipped: missing DISPATCH_INTERNAL_SECRET/CRON_SECRET"
    );
    return;
  }

  void fetch(`${origin.replace(/\/$/, "")}/api/dispatch/taxi-ride`, {
    method: "POST",
    headers,
    body: JSON.stringify({ taxiRideId, taxi_ride_id: taxiRideId, wave }),
  }).catch((err) => {
    console.log("[scheduleTaxiRideDispatch] async trigger failed:", err);
  });
}
