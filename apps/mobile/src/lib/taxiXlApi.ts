import { API_BASE_URL } from "./apiBase";
import { supabase } from "./supabase";

async function headers() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Session expired. Please sign in again.");
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

async function post(path: string, body: Record<string, unknown>) {
  const response = await fetch(`${String(API_BASE_URL).replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: await headers(),
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error ?? "request_failed");
  }
  return payload;
}

export async function fetchGuineaXlDepartures() {
  const response = await fetch(`${String(API_BASE_URL).replace(/\/$/, "")}/api/taxi/xl/departures`, {
    headers: await headers(),
  });
  const payload = (await response.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!response.ok || payload.ok === false) throw new Error(payload.error ?? "request_failed");
  return payload as {
    departures: Array<Record<string, unknown>>;
    axes: Array<Record<string, unknown>>;
  };
}

export function quoteGuineaXl(body: Record<string, unknown>) {
  return post("/api/taxi/xl/quote", body);
}

export function bookGuineaXl(body: Record<string, unknown>) {
  return post("/api/taxi/xl/bookings", body);
}

export function openGuineaXlDeparture(body: Record<string, unknown>) {
  return post("/api/taxi/xl/departures", body);
}

export function completeGuineaXlDeparture(departureId: string) {
  return post("/api/taxi/xl/departures", { action: "complete", departureId });
}

export function collectGuineaXlCash(bookingId: string) {
  return post("/api/taxi/xl/cash-collected", { bookingId });
}
