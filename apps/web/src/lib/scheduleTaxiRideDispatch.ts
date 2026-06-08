import { buildDispatchInternalHeaders } from "@/lib/dispatchInternalAuth";

export type TaxiDispatchTriggerResult = {
  ok: boolean;
  error?: string;
  skipped?: boolean;
  httpStatus?: number;
  body?: Record<string, unknown>;
};

export async function triggerTaxiRideDispatch(params: {
  origin: string;
  taxiRideId: string;
  wave?: number;
}): Promise<TaxiDispatchTriggerResult> {
  const { origin, taxiRideId, wave = 1 } = params;
  const headers = {
    "Content-Type": "application/json",
    ...buildDispatchInternalHeaders(),
  };

  if (!headers["x-dispatch-internal-secret"]) {
    console.error(
      "[scheduleTaxiRideDispatch] DISPATCH BLOCKED: missing DISPATCH_INTERNAL_SECRET/CRON_SECRET",
      { taxiRideId, wave }
    );
    return {
      ok: false,
      skipped: true,
      error: "missing_dispatch_internal_secret",
    };
  }

  try {
    const res = await fetch(`${origin.replace(/\/$/, "")}/api/dispatch/taxi-ride`, {
      method: "POST",
      headers,
      body: JSON.stringify({ taxiRideId, taxi_ride_id: taxiRideId, wave }),
    });

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok || body.ok === false) {
      console.error("[scheduleTaxiRideDispatch] dispatch HTTP failed", {
        taxiRideId,
        wave,
        httpStatus: res.status,
        error: body.error ?? body.message,
      });
      return {
        ok: false,
        error: String(body.error ?? body.message ?? `HTTP ${res.status}`),
        httpStatus: res.status,
        body,
      };
    }

    return { ok: true, body };
  } catch (err) {
    console.error("[scheduleTaxiRideDispatch] dispatch network failed", {
      taxiRideId,
      wave,
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      ok: false,
      error: err instanceof Error ? err.message : "dispatch_network_failed",
    };
  }
}

export function scheduleTaxiRideDispatch(params: {
  origin: string;
  taxiRideId: string;
  wave?: number;
}) {
  void triggerTaxiRideDispatch(params).then((result) => {
    if (!result.ok) {
      console.error("[scheduleTaxiRideDispatch] async dispatch failed", {
        ...params,
        result,
      });
    }
  });
}
