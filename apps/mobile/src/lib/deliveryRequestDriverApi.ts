import { API_BASE_URL } from "./apiBase";
import { supabase } from "./supabase";

async function getAuthHeaders() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const token = data.session?.access_token;
  if (!token) {
    throw new Error("Session expirée. Reconnecte-toi puis réessaie.");
  }

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function getBaseUrl() {
  return String(API_BASE_URL).replace(/\/$/, "");
}

async function postDeliveryRequestApi(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${getBaseUrl()}${path}`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(body),
  });

  const out = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(out?.error ?? `Request failed (${res.status})`);
  }

  return out;
}

export function acceptDeliveryRequest(deliveryRequestId: string) {
  return postDeliveryRequestApi("/api/delivery-requests/accept", {
    delivery_request_id: deliveryRequestId,
  });
}

export function cancelDeliveryRequestAsDriver(deliveryRequestId: string) {
  return postDeliveryRequestApi("/api/delivery-requests/driver-cancel", {
    delivery_request_id: deliveryRequestId,
  });
}

export function cancelDeliveryRequestAsClient(deliveryRequestId: string) {
  return postDeliveryRequestApi("/api/delivery-requests/cancel", {
    delivery_request_id: deliveryRequestId,
  });
}

export function confirmDeliveryRequestPickup(params: {
  deliveryRequestId: string;
  pickupCode: string;
  proofPhotoUrl: string | null;
}) {
  return postDeliveryRequestApi("/api/delivery-requests/pickup-confirm", {
    delivery_request_id: params.deliveryRequestId,
    pickup_code: params.pickupCode,
    proof_photo_url: params.proofPhotoUrl,
  });
}

export function confirmDeliveryRequestDelivered(params: {
  deliveryRequestId: string;
  dropoffCode: string;
  proofPhotoUrl: string | null;
}) {
  return postDeliveryRequestApi("/api/delivery-requests/delivered-confirm", {
    delivery_request_id: params.deliveryRequestId,
    dropoff_code: params.dropoffCode,
    proof_photo_url: params.proofPhotoUrl,
  });
}
