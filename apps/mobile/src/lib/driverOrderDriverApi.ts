import { API_BASE_URL } from "./apiBase";
import { supabase } from "./supabase";

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

function baseUrl() {
  return String(API_BASE_URL).replace(/\/$/, "");
}

async function driverPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl()}${path}`, {
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

export function acceptFoodOrderOffer(offerId: string) {
  return driverPost("/api/orders/offers/accept", { offer_id: offerId });
}

export function acceptReadyFoodOrder(orderId: string) {
  return driverPost("/api/orders/accept-ready", { order_id: orderId });
}

export function acceptDeliveryRequestOffer(offerId: string) {
  return driverPost("/api/delivery-requests/offers/accept", { offer_id: offerId });
}
