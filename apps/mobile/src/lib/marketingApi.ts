import { API_BASE_URL } from "./apiBase";
import { supabase } from "./supabase";
import { logTechnicalError, toUserFacingError } from "./userFacingError";

async function getAuthHeaders() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Session expired. Please sign in again.");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function baseUrl() {
  return String(API_BASE_URL).replace(/\/$/, "");
}

export async function fetchMarketingSummary(params?: {
  service?: string;
  subtotalCents?: number;
  deliveryFeeCents?: number;
  promoCode?: string;
}) {
  const q = new URLSearchParams();
  q.set("service", params?.service ?? "food");
  q.set("subtotal_cents", String(params?.subtotalCents ?? 0));
  q.set("delivery_fee_cents", String(params?.deliveryFeeCents ?? 0));
  if (params?.promoCode) q.set("promo_code", params.promoCode);
  const res = await fetch(`${baseUrl()}/api/marketing/summary?${q}`, {
    headers: await getAuthHeaders(),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok || out?.ok === false) {
    logTechnicalError("marketing.summary", out, { status: res.status });
    throw new Error(toUserFacingError(out, "Chargement promotions impossible."));
  }
  return out;
}

export async function validateMarketingCode(body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl()}/api/marketing/actions`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify({ action: "validate_code", ...body }),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok || out?.ok === false) {
    logTechnicalError("marketing.validate", out, { status: res.status });
    throw new Error(toUserFacingError(out, "Code refusé."));
  }
  return out;
}
