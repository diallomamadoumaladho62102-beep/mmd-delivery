import { getApiBaseUrl } from "./apiBase";
import { supabase } from "./supabase";
import type { DeliveryRequestReceipt } from "./entityReceiptTypes";

export async function fetchDeliveryRequestReceipt(
  deliveryRequestId: string
): Promise<DeliveryRequestReceipt> {
  const id = String(deliveryRequestId ?? "").trim();
  if (!id) throw new Error("deliveryRequestId_required");

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Session expired");

  const base = getApiBaseUrl().replace(/\/$/, "");
  const res = await fetch(`${base}/api/delivery-requests/${id}/receipt`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    receipt?: DeliveryRequestReceipt;
    error?: string;
  };
  if (!res.ok || !json.receipt) {
    throw new Error(String(json.error ?? `HTTP ${res.status}`));
  }
  return json.receipt;
}
