import type { SupabaseClient } from "@supabase/supabase-js";

export type DeliveryRequestRpcResult = {
  ok?: boolean;
  message?: string;
  error?: string;
};

export function getDeliveryRequestId(body: Record<string, unknown>): string {
  const raw = String(
    body.delivery_request_id ?? body.deliveryRequestId ?? body.request_id ?? ""
  ).trim();

  if (!raw) {
    throw new Error("Missing delivery_request_id");
  }

  if (!/^[0-9a-f-]{36}$/i.test(raw)) {
    throw new Error("Invalid delivery_request_id");
  }

  return raw;
}

export async function findLinkedOrderId(
  supabaseAdmin: SupabaseClient,
  deliveryRequestId: string
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("id")
    .eq("external_ref_id", deliveryRequestId)
    .eq("external_ref_type", "delivery_request")
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data?.id ? String(data.id) : null;
}

export async function syncLinkedOrderAfterPickup(params: {
  supabaseAdmin: SupabaseClient;
  deliveryRequestId: string;
  proofPhotoUrl: string | null;
}) {
  const orderId = await findLinkedOrderId(
    params.supabaseAdmin,
    params.deliveryRequestId
  );

  if (!orderId) return null;

  const nowIso = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    picked_up_at: nowIso,
    updated_at: nowIso,
  };

  if (params.proofPhotoUrl) {
    updatePayload.pickup_photo_url = params.proofPhotoUrl;
  }

  const { error } = await params.supabaseAdmin
    .from("orders")
    .update(updatePayload)
    .eq("id", orderId);

  if (error) {
    throw new Error(error.message);
  }

  return orderId;
}

export async function syncLinkedOrderAfterDelivery(params: {
  supabaseAdmin: SupabaseClient;
  deliveryRequestId: string;
  proofPhotoUrl: string | null;
}) {
  const orderId = await findLinkedOrderId(
    params.supabaseAdmin,
    params.deliveryRequestId
  );

  if (!orderId) return null;

  const nowIso = new Date().toISOString();
  const updatePayload: Record<string, unknown> = {
    status: "delivered",
    delivered_confirmed_at: nowIso,
    updated_at: nowIso,
  };

  if (params.proofPhotoUrl) {
    updatePayload.dropoff_photo_url = params.proofPhotoUrl;
  }

  const { error } = await params.supabaseAdmin
    .from("orders")
    .update(updatePayload)
    .eq("id", orderId);

  if (error) {
    throw new Error(error.message);
  }

  return orderId;
}

export function mapDeliveryRpcError(errorCode: string): { status: number; message: string } {
  switch (errorCode) {
    case "not_authenticated":
      return { status: 401, message: "Unauthorized" };
    case "invalid_pickup_code":
    case "invalid_dropoff_code":
      return { status: 400, message: "Invalid code" };
    case "invalid_status":
    case "request_not_available":
    case "release_not_allowed":
      return { status: 409, message: "Request status changed" };
    case "request_not_found":
      return { status: 404, message: "Delivery request not found" };
    default:
      return { status: 400, message: errorCode || "Request failed" };
  }
}
