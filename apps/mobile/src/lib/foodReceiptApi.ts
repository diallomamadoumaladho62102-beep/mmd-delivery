import { getApiBaseUrl } from "./apiBase";
import { supabase } from "./supabase";
import type { FoodOrderReceipt } from "./entityReceiptTypes";

export async function fetchFoodOrderReceipt(
  orderId: string
): Promise<FoodOrderReceipt> {
  const id = String(orderId ?? "").trim();
  if (!id) throw new Error("orderId_required");

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Session expired");

  const base = getApiBaseUrl().replace(/\/$/, "");
  const res = await fetch(`${base}/api/orders/${id}/receipt`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    receipt?: FoodOrderReceipt;
    error?: string;
  };
  if (!res.ok || !json.receipt) {
    throw new Error(String(json.error ?? `HTTP ${res.status}`));
  }
  return json.receipt;
}
