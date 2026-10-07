import { API_BASE_URL } from "./apiBase";
import { supabase } from "./supabase";

export type DeliveryStageEntityType = "order" | "delivery_request";

async function getAuthHeaders() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) {
    throw new Error("Session expired. Please sign in again.");
  }
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function getBaseUrl() {
  return String(API_BASE_URL).replace(/\/$/, "");
}

export async function fetchDeliveryPickupArrival(params: {
  entityType: DeliveryStageEntityType;
  entityId: string;
}): Promise<{ arrived: boolean; arrived_at: string | null }> {
  const query = new URLSearchParams({
    entity_type: params.entityType,
    entity_id: params.entityId,
  });
  const res = await fetch(`${getBaseUrl()}/api/delivery/arrive-pickup?${query}`, {
    headers: await getAuthHeaders(),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(out?.error ?? `Request failed (${res.status})`);
  }
  return {
    arrived: Boolean(out?.arrived),
    arrived_at: out?.arrived_at ?? null,
  };
}

export async function confirmDeliveryPickupArrival(params: {
  entityType: DeliveryStageEntityType;
  entityId: string;
  driverLat?: number | null;
  driverLng?: number | null;
}) {
  const res = await fetch(`${getBaseUrl()}/api/delivery/arrive-pickup`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify({
      entity_type: params.entityType,
      entity_id: params.entityId,
      driver_lat: params.driverLat ?? null,
      driver_lng: params.driverLng ?? null,
    }),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(out?.error ?? `Request failed (${res.status})`);
  }
  return out;
}
