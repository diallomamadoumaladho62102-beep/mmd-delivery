import { getApiBaseUrl } from "./apiBase";
import { supabase } from "./supabase";

export type RestaurantAutomationSettings = {
  auto_accept_orders_enabled: boolean;
  auto_accept_only_during_hours: boolean;
  default_prep_minutes: number;
  auto_pause_when_closed: boolean;
  auto_pause_when_busy: boolean;
  busy_order_threshold: number;
  auto_print_enabled: boolean;
  print_kitchen_ticket: boolean;
  print_customer_ticket: boolean;
  print_driver_ticket: boolean;
  print_copies: number;
  print_paper_width: "58mm" | "80mm";
  print_show_qr_code: boolean;
  print_special_instructions: boolean;
};

async function authFetch(path: string, init?: RequestInit) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(String(body.error ?? body.message ?? `Request failed (${res.status})`));
  }
  return body;
}

export async function fetchRestaurantAutomationSettings(): Promise<{
  settings: RestaurantAutomationSettings;
  opening_hours: Record<string, { open?: string; close?: string }> | null;
}> {
  const body = await authFetch("/api/restaurant/order-automation/settings");
  return {
    settings: body.settings,
    opening_hours: body.opening_hours ?? null,
  };
}

export async function updateRestaurantAutomationSettings(
  patch: Partial<RestaurantAutomationSettings>,
): Promise<RestaurantAutomationSettings> {
  const body = await authFetch("/api/restaurant/order-automation/settings", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return body.settings;
}

export async function requestRestaurantTestPrint(): Promise<string> {
  const body = await authFetch("/api/restaurant/order-automation/test-print", {
    method: "POST",
    body: JSON.stringify({}),
  });
  return String(body.job_id ?? "");
}

export async function requestOrderPrint(orderId: string, source: "manual" | "reprint" = "manual") {
  return authFetch(`/api/restaurant/orders/${encodeURIComponent(orderId)}/print`, {
    method: "POST",
    body: JSON.stringify({ source }),
  });
}

export async function fetchPendingPrintJobs() {
  const body = await authFetch("/api/restaurant/print-jobs?status=pending");
  return body.jobs ?? [];
}

export async function ackPrintJob(
  jobId: string,
  status: "printing" | "printed" | "failed",
  errorMessage?: string,
) {
  return authFetch("/api/restaurant/print-jobs", {
    method: "PATCH",
    body: JSON.stringify({
      job_id: jobId,
      status,
      error_message: errorMessage ?? null,
    }),
  });
}
