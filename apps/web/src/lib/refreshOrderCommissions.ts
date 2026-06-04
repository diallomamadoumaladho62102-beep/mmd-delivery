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

export async function ensureOrderCommissionsReady(
  supabaseAdmin: SupabaseClient,
  orderId: string,
  context: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const refreshed = await refreshOrderCommissions(supabaseAdmin, orderId);

  if (!refreshed.ok) {
    console.error("[ensureOrderCommissionsReady] refresh failed", {
      orderId,
      context,
      error: refreshed.error ?? "refresh_order_commissions_failed",
    });
    return {
      ok: false,
      error: refreshed.error ?? "refresh_order_commissions_failed",
    };
  }

  const { data, error } = await supabaseAdmin
    .from("order_commissions")
    .select("order_id")
    .eq("order_id", orderId)
    .maybeSingle<{ order_id: string }>();

  if (error) {
    console.error("[ensureOrderCommissionsReady] read failed", {
      orderId,
      context,
      message: error.message,
    });
    return { ok: false, error: error.message };
  }

  if (!data?.order_id) {
    console.error("[ensureOrderCommissionsReady] row missing", {
      orderId,
      context,
    });
    return { ok: false, error: "order_commissions_missing" };
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
