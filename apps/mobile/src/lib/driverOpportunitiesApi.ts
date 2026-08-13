import { getApiBaseUrl } from "./apiBase";
import { supabase } from "./supabase";

export type DriverOpportunityCategory =
  | "saved"
  | "promotions"
  | "airports"
  | "reservations"
  | "events";

export type DriverOpportunityFeedItem = {
  id: string;
  category: Exclude<DriverOpportunityCategory, "saved">;
  title: string;
  subtitle: string | null;
  starts_at: string | null;
  ends_at: string | null;
  lat: number | null;
  lng: number | null;
  bonus_cents: number;
  currency: string;
  capacity: number | null;
  status: string;
  is_saved: boolean;
  is_joined: boolean;
  signup_count: number;
  distance_miles: number | null;
};

async function authHeaders() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

function formatIsoDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function fetchDriverOpportunities(params: {
  day?: Date;
  category?: DriverOpportunityCategory;
  lat?: number | null;
  lng?: number | null;
}): Promise<DriverOpportunityFeedItem[]> {
  const qs = new URLSearchParams();
  if (params.day) qs.set("day", formatIsoDay(params.day));
  if (params.category) qs.set("category", params.category);
  if (params.lat != null && Number.isFinite(params.lat)) qs.set("lat", String(params.lat));
  if (params.lng != null && Number.isFinite(params.lng)) qs.set("lng", String(params.lng));

  const suffix = qs.toString();
  const url = `${getApiBaseUrl()}/api/driver/opportunities${suffix ? `?${suffix}` : ""}`;

  const res = await fetch(url, { headers: await authHeaders() });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(String(body.message ?? body.error ?? "Unable to load opportunities"));
  }

  return Array.isArray(body.opportunities) ? (body.opportunities as DriverOpportunityFeedItem[]) : [];
}

export async function saveDriverOpportunity(opportunityId: string, saved: boolean): Promise<void> {
  const res = await fetch(`${getApiBaseUrl()}/api/driver/opportunities/save`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ opportunity_id: opportunityId, saved }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(String(body.message ?? body.error ?? "Unable to save opportunity"));
  }
}

export async function joinDriverOpportunity(opportunityId: string): Promise<{ alreadyJoined: boolean }> {
  const res = await fetch(`${getApiBaseUrl()}/api/driver/opportunities/join`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({ opportunity_id: opportunityId }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) {
    throw new Error(String(body.message ?? body.error ?? "Unable to join opportunity"));
  }
  return { alreadyJoined: Boolean(body.already_joined) };
}
