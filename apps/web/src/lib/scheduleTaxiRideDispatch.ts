import type { SupabaseClient } from "@supabase/supabase-js";
import { buildDispatchInternalHeaders, getDispatchInternalSecret } from "@/lib/dispatchInternalAuth";
import { logTaxiEventServer } from "@/lib/taxiEvents";

export type TaxiDispatchTriggerResult = {
  ok: boolean;
  error?: string;
  message?: string;
  httpStatus?: number;
  body?: Record<string, unknown>;
};

async function logDispatchSecretMissing(
  supabaseAdmin: SupabaseClient | null | undefined,
  taxiRideId: string,
  wave: number
): Promise<void> {
  console.error(
    "[scheduleTaxiRideDispatch] DISPATCH BLOCKED: missing DISPATCH_INTERNAL_SECRET/CRON_SECRET",
    { taxiRideId, wave, error: "dispatch_secret_missing" }
  );

  if (!supabaseAdmin) return;

  await logTaxiEventServer(supabaseAdmin, {
    rideId: taxiRideId,
    eventType: "dispatch_secret_missing",
    triggeredRole: "system",
    description:
      "Taxi dispatch blocked — configure DISPATCH_INTERNAL_SECRET or CRON_SECRET",
    metadata: { wave, error: "dispatch_secret_missing" },
  });
}

export async function triggerTaxiRideDispatch(params: {
  origin: string;
  taxiRideId: string;
  wave?: number;
  supabaseAdmin?: SupabaseClient | null;
}): Promise<TaxiDispatchTriggerResult> {
  const { origin, taxiRideId, wave = 1, supabaseAdmin } = params;

  if (!getDispatchInternalSecret()) {
    await logDispatchSecretMissing(supabaseAdmin, taxiRideId, wave);
    return {
      ok: false,
      error: "dispatch_secret_missing",
      message:
        "Taxi dispatch blocked — configure DISPATCH_INTERNAL_SECRET or CRON_SECRET",
    };
  }

  const headers = {
    "Content-Type": "application/json",
    ...buildDispatchInternalHeaders(),
  };

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
  supabaseAdmin?: SupabaseClient | null;
}) {
  void triggerTaxiRideDispatch(params).then((result) => {
    if (!result.ok) {
      console.error("[scheduleTaxiRideDispatch] async dispatch failed", {
        taxiRideId: params.taxiRideId,
        wave: params.wave ?? 1,
        error: result.error,
        message: result.message,
      });
    }
  });
}
