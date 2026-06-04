import type { SupabaseClient } from "@supabase/supabase-js";

export async function refreshOrderCommissions(
  supabaseAdmin: SupabaseClient,
  orderId: string
): Promise<{ ok: boolean; error?: string }> {
  const normalized = String(orderId ?? "").trim();
  if (!normalized) {
    return { ok: false, error: "order_id_required" };
  }

  const { data, error } = await supabaseAdmin.rpc("refresh_order_commissions", {
    p_order_id: normalized,
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  const payload = (data ?? null) as { ok?: boolean; error?: string } | null;
  if (payload?.ok === false) {
    return {
      ok: false,
      error: String(payload.error ?? "refresh_order_commissions_failed"),
    };
  }

  return { ok: true };
}

export async function refreshCommissionsForDeliveryRequest(
  supabaseAdmin: SupabaseClient,
  deliveryRequestId: string
): Promise<void> {
  const requestId = String(deliveryRequestId ?? "").trim();
  if (!requestId) return;

  const { data: linkedOrder } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("external_ref_id", requestId)
    .eq("external_ref_type", "delivery_request")
    .maybeSingle<{ id: string }>();

  if (linkedOrder?.id) {
    await refreshOrderCommissions(supabaseAdmin, linkedOrder.id);
  }
}
