import type { SupabaseClient } from "@supabase/supabase-js";

export type ServiceCancellationInput = {
  entityType: "taxi_ride" | "order" | "delivery_request" | "seller_order";
  entityId: string;
  serviceType: "taxi" | "food" | "package" | "marketplace";
  actorUserId: string;
  actorRole: "client" | "driver" | "restaurant" | "seller";
  reasonCode: string;
  reasonNote?: string | null;
  previousStatus?: string | null;
  resultingStatus?: string | null;
  waitMinutes?: number | null;
  waitFeeCents?: number | null;
  paymentStatus?: string | null;
  refundAmountCents?: number | null;
  acceptanceRateImpact?: boolean;
  cancellationRateImpact?: boolean;
  cancellationSource: string;
  noShow?: boolean;
  postAcceptance?: boolean;
  metadata?: Record<string, unknown>;
};

export async function recordServiceCancellation(
  supabaseAdmin: SupabaseClient,
  input: ServiceCancellationInput,
): Promise<{ ok: true; id: string | null } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin
    .from("service_cancellations")
    .insert({
      entity_type: input.entityType,
      entity_id: input.entityId,
      service_type: input.serviceType,
      actor_user_id: input.actorUserId,
      actor_role: input.actorRole,
      reason_code: input.reasonCode,
      reason_note: input.reasonNote ?? null,
      previous_status: input.previousStatus ?? null,
      resulting_status: input.resultingStatus ?? null,
      wait_minutes: input.waitMinutes ?? null,
      wait_fee_cents: input.waitFeeCents ?? null,
      payment_status: input.paymentStatus ?? null,
      refund_amount_cents: input.refundAmountCents ?? null,
      acceptance_rate_impact: input.acceptanceRateImpact === true,
      cancellation_rate_impact: input.cancellationRateImpact === true,
      cancellation_source: input.cancellationSource,
      no_show: input.noShow === true,
      post_acceptance: input.postAcceptance === true,
      metadata: input.metadata ?? {},
    })
    .select("id")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data?.id ? String(data.id) : null };
}
