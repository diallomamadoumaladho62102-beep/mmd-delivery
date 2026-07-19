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

async function mmdPlusGet(path: string) {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "GET",
    headers: await getAuthHeaders(),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok || out?.ok === false) {
    logTechnicalError(`mmdPlus.get${path}`, out, { status: res.status });
    throw new Error(
      toUserFacingError(
        out,
        "Une action temporairement impossible s'est produite. Veuillez réessayer."
      )
    );
  }
  return out;
}

async function mmdPlusPost(path: string, body: Record<string, unknown>) {
  const res = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok || out?.ok === false) {
    logTechnicalError(`mmdPlus.post${path}`, out, { status: res.status });
    throw new Error(
      toUserFacingError(
        out,
        "Une action temporairement impossible s'est produite. Veuillez réessayer."
      )
    );
  }
  return out;
}

export type MmdPlusPlan = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_cents: number;
  currency: string;
  billing_period: string;
  color: string | null;
  features?: Array<{ feature_key: string; label?: string }>;
};

export type MmdPlusCurrent = {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  is_trial: boolean;
  price_cents: number;
  currency: string;
  plan?: MmdPlusPlan | null;
  features?: Array<{ feature_key: string; label?: string }>;
};

export type MmdPlusInvoice = {
  id: string;
  kind: string;
  status: string;
  amount_cents: number;
  currency: string;
  created_at: string;
  description: string | null;
};

export async function fetchMmdPlusSummary(): Promise<{
  current: MmdPlusCurrent | null;
  plans: MmdPlusPlan[];
  invoices: MmdPlusInvoice[];
}> {
  const out = await mmdPlusGet("/api/mmd-plus/summary");
  return {
    current: (out.current as MmdPlusCurrent) ?? null,
    plans: (out.plans as MmdPlusPlan[]) ?? [],
    invoices: (out.invoices as MmdPlusInvoice[]) ?? [],
  };
}

export async function mmdPlusAction(
  action: string,
  extra?: Record<string, unknown>
) {
  return mmdPlusPost("/api/mmd-plus/actions", { action, ...extra });
}
