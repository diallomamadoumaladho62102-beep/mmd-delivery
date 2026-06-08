import type { SupabaseClient } from "@supabase/supabase-js";

export type TaxiEventRole = "client" | "driver" | "admin" | "system";

export async function logTaxiEventServer(
  supabaseAdmin: SupabaseClient,
  params: {
    rideId: string;
    eventType: string;
    oldStatus?: string | null;
    newStatus?: string | null;
    actorId?: string | null;
    triggeredRole?: TaxiEventRole | null;
    description?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc("log_taxi_event", {
    p_ride_id: params.rideId,
    p_event_type: params.eventType,
    p_old_status: params.oldStatus ?? null,
    p_new_status: params.newStatus ?? null,
    p_actor_id: params.actorId ?? null,
    p_triggered_role: params.triggeredRole ?? null,
    p_description: params.description ?? null,
    p_metadata: params.metadata ?? {},
  });

  if (error) {
    console.log("[logTaxiEventServer]", error.message, params.eventType);
    return null;
  }

  return typeof data === "string" ? data : null;
}
