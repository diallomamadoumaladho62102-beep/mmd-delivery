import { getApiBaseUrl } from "./apiBase";
import { supabase } from "./supabase";
import type { TaxiReceipt } from "./taxiReceiptTypes";

export async function fetchTaxiReceipt(rideId: string): Promise<TaxiReceipt> {
  const id = String(rideId ?? "").trim();
  if (!id) throw new Error("rideId_required");

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Session expired");

  const base = getApiBaseUrl().replace(/\/$/, "");
  const res = await fetch(`${base}/api/taxi/rides/${id}/receipt`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    receipt?: TaxiReceipt;
    error?: string;
  };
  if (!res.ok || !json.receipt) {
    throw new Error(String(json.error ?? `HTTP ${res.status}`));
  }
  return json.receipt;
}
