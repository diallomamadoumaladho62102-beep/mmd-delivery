import { getApiBaseUrl } from "./apiBase";
import { supabase } from "./supabase";

export type DriverMarketplaceJob = {
  id: string;
  seller_order_id: string;
  seller_id: string;
  status: string;
  pickup_address: string | null;
  dropoff_address: string | null;
  estimated_distance_miles: number | null;
  estimated_minutes: number | null;
  driver_earning_cents: number;
  assigned_driver_id: string | null;
  live_dispatch_enabled: boolean;
  created_at: string;
  updated_at: string;
  seller_business_name: string | null;
  seller_country_code: string | null;
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

export async function fetchDriverMarketplaceJobs(): Promise<{
  available: DriverMarketplaceJob[];
  mine: DriverMarketplaceJob[];
}> {
  const body = await authFetch("/api/driver/marketplace-jobs");
  return {
    available: body.available ?? [],
    mine: body.mine ?? [],
  };
}

export async function fetchDriverMarketplaceJob(jobId: string): Promise<DriverMarketplaceJob> {
  const body = await authFetch(`/api/driver/marketplace-jobs?job_id=${encodeURIComponent(jobId)}`);
  const job = body?.job as DriverMarketplaceJob | undefined;
  if (!job?.id) {
    throw new Error("Job introuvable ou indisponible");
  }
  return job;
}

export async function acceptDriverMarketplaceJob(jobId: string): Promise<DriverMarketplaceJob> {
  const body = await authFetch("/api/driver/marketplace-jobs/accept", {
    method: "POST",
    body: JSON.stringify({ job_id: jobId }),
  });
  return body.job as DriverMarketplaceJob;
}

export async function updateDriverMarketplaceJobStatus(
  jobId: string,
  status: "picked_up" | "delivered"
): Promise<DriverMarketplaceJob> {
  const body = await authFetch("/api/driver/marketplace-jobs/status", {
    method: "POST",
    body: JSON.stringify({ job_id: jobId, status }),
  });
  return body.job as DriverMarketplaceJob;
}

export function mapMarketplaceJobToDriverOrder(job: DriverMarketplaceJob) {
  return {
    id: job.id,
    kind: "marketplace" as const,
    status: job.status,
    created_at: job.created_at,
    restaurant_name: job.seller_business_name,
    pickup_address: job.pickup_address,
    dropoff_address: job.dropoff_address,
    distance_miles: job.estimated_distance_miles,
    delivery_fee: null,
    driver_delivery_payout: (job.driver_earning_cents ?? 0) / 100,
    total: null,
    pickup_lat: null,
    pickup_lng: null,
    dropoff_lat: null,
    dropoff_lng: null,
    source_table: "marketplace_delivery_jobs" as const,
    offer_id: null,
    offer_expires_at: null,
    is_dispatch_offer: false,
    marketplace_job_status: job.status,
  };
}
